import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EliminacionEstablecimientoService } from '../../src/plataforma/eliminacion-establecimiento.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { KeycloakAdminService } from '../../src/keycloak-admin/keycloak-admin.service';
import { AuditLogService } from '../../src/audit-log/audit-log.service';
import { AuditAction } from '../../src/audit-log/audit-action.enum';

/**
 * BL-418: eliminar un establecimiento creado por error, sin actividad. La
 * base, Keycloak y la auditoría se simulan.
 */

const TENANT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const OTRO_TENANT_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const RUT = '219999990016';
const ACTOR = { id: 'kc-plataforma-1' };

const usuarioKc = (id: string, tenantId: string) => ({
  id,
  username: `u-${id}`,
  attributes: { tenant_id: [tenantId] },
});

const errorFk = () =>
  new Prisma.PrismaClientKnownRequestError('FK', {
    code: 'P2003',
    clientVersion: 'test',
  });

describe('EliminacionEstablecimientoService (BL-418)', () => {
  let contextos: string[];
  let borrados: string[];
  let tx: any;
  let keycloak: { listarUsuariosDelTenant: jest.Mock; deleteUser: jest.Mock };
  let auditLog: { registrar: jest.Mock };
  let service: EliminacionEstablecimientoService;

  // Registra el orden en que se borra cada tabla.
  const borrar = (tabla: string) =>
    jest.fn(() => {
      borrados.push(tabla);
      return Promise.resolve({ count: 1 });
    });

  beforeEach(() => {
    contextos = [];
    borrados = [];
    tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ rut: RUT }),
        delete: borrar('tenant'),
      },
      pedido: { findFirst: jest.fn().mockResolvedValue(null) },
      itemCarta: { deleteMany: borrar('itemCarta') },
      categoriaCarta: { deleteMany: borrar('categoriaCarta') },
      mesa: { deleteMany: borrar('mesa') },
      usuario: { deleteMany: borrar('usuario') },
      restaurante: { deleteMany: borrar('restaurante') },
    };
    const tenantPrisma = {
      runInTenantContext: jest.fn((tenantId: string, fn: any) => {
        contextos.push(tenantId);
        return fn(tx);
      }),
    };
    keycloak = {
      listarUsuariosDelTenant: jest
        .fn()
        .mockResolvedValue([
          usuarioKc('kc-admin', TENANT_ID),
          usuarioKc('kc-cocina', TENANT_ID),
          usuarioKc('kc-comensal', TENANT_ID),
          usuarioKc('kc-ajeno', OTRO_TENANT_ID),
        ]),
      deleteUser: jest.fn().mockResolvedValue(undefined),
    };
    auditLog = { registrar: jest.fn() };
    service = new EliminacionEstablecimientoService(
      tenantPrisma as unknown as TenantPrismaService,
      keycloak as unknown as KeycloakAdminService,
      auditLog as unknown as AuditLogService,
    );
  });

  it('[TC-U-166] borra de hijos a padres en una transacción del tenant, con el candado por tenant', async () => {
    await service.eliminar(TENANT_ID, RUT, ACTOR);

    expect(contextos).toEqual([TENANT_ID]);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      TENANT_ID,
    );
    expect(borrados).toEqual([
      'itemCarta',
      'categoriaCarta',
      'mesa',
      'usuario',
      'restaurante',
      'tenant',
    ]);
    expect(tx.mesa.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
    });
    expect(tx.tenant.delete).toHaveBeenCalledWith({ where: { id: TENANT_ID } });
  });

  it('[TC-U-167] borra en Keycloak solo las cuentas de ese tenant y audita con el RUT', async () => {
    const resultado = await service.eliminar(TENANT_ID, RUT, ACTOR);

    expect(keycloak.deleteUser).toHaveBeenCalledTimes(3);
    expect(keycloak.deleteUser).not.toHaveBeenCalledWith('kc-ajeno');
    expect(resultado).toEqual({
      tenantId: TENANT_ID,
      datosEliminados: true,
      cuentas: { eliminadas: 3, pendientes: [] },
    });
    expect(auditLog.registrar).toHaveBeenCalledWith({
      action: AuditAction.ESTABLECIMIENTO_ELIMINADO,
      tenantId: TENANT_ID,
      actorKeycloakId: ACTOR.id,
      targetUsuarioId: TENANT_ID,
      detalle: { rut: RUT, cuentas: { eliminadas: 3, pendientes: [] } },
    });
  });

  it('[TC-U-168] con algún pedido da 409 y no borra nada', async () => {
    tx.pedido.findFirst.mockResolvedValue({ id: 'pedido-1' });

    await expect(
      service.eliminar(TENANT_ID, RUT, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(borrados).toEqual([]);
    expect(keycloak.deleteUser).not.toHaveBeenCalled();
    expect(auditLog.registrar).not.toHaveBeenCalled();
  });

  it('[TC-U-169] con otro RUT da 400 y no borra nada', async () => {
    await expect(
      service.eliminar(TENANT_ID, '219999990024', ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(borrados).toEqual([]);
    expect(keycloak.listarUsuariosDelTenant).not.toHaveBeenCalled();
  });

  it('BL-418: si entra un pedido durante el borrado (FK, P2003) da 409', async () => {
    tx.mesa.deleteMany.mockRejectedValue(errorFk());

    await expect(
      service.eliminar(TENANT_ID, RUT, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(keycloak.deleteUser).not.toHaveBeenCalled();
  });

  it('[TC-U-170] si una cuenta de Keycloak falla, sigue con las demás e informa cuál quedó', async () => {
    keycloak.deleteUser.mockImplementation((id: string) =>
      id === 'kc-cocina'
        ? Promise.reject(new Error('Keycloak caído'))
        : Promise.resolve(),
    );

    const resultado = await service.eliminar(TENANT_ID, RUT, ACTOR);

    expect(keycloak.deleteUser).toHaveBeenCalledTimes(3);
    expect(resultado.datosEliminados).toBe(true);
    expect(resultado.cuentas).toEqual({
      eliminadas: 2,
      pendientes: ['u-kc-cocina'],
    });
  });

  it('BL-418: si no se pueden listar las cuentas, los datos quedan borrados y pendientes es null', async () => {
    keycloak.listarUsuariosDelTenant.mockRejectedValue(new Error('caído'));

    const resultado = await service.eliminar(TENANT_ID, RUT, ACTOR);

    expect(borrados).toContain('tenant');
    expect(resultado.cuentas).toEqual({ eliminadas: 0, pendientes: null });
  });

  describe('reintento (el tenant ya no existe)', () => {
    beforeEach(() => {
      tx.tenant.findUnique.mockResolvedValue(null);
    });

    it('[TC-U-171] borra las cuentas que quedaron y lo audita como reintento', async () => {
      keycloak.listarUsuariosDelTenant.mockResolvedValue([
        usuarioKc('kc-cocina', TENANT_ID),
      ]);

      const resultado = await service.eliminar(TENANT_ID, RUT, ACTOR);

      expect(borrados).toEqual([]);
      expect(keycloak.deleteUser).toHaveBeenCalledWith('kc-cocina');
      expect(resultado).toEqual({
        tenantId: TENANT_ID,
        datosEliminados: false,
        cuentas: { eliminadas: 1, pendientes: [] },
      });
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ESTABLECIMIENTO_ELIMINADO,
          detalle: {
            reintento: true,
            cuentas: { eliminadas: 1, pendientes: [] },
          },
        }),
      );
    });

    it('BL-418: sin cuentas que borrar da 404', async () => {
      keycloak.listarUsuariosDelTenant.mockResolvedValue([]);

      await expect(
        service.eliminar(TENANT_ID, RUT, ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('BL-418: si Keycloak no responde da 503', async () => {
      keycloak.listarUsuariosDelTenant.mockRejectedValue(new Error('caído'));

      await expect(
        service.eliminar(TENANT_ID, RUT, ACTOR),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
