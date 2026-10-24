import { ConflictException, NotFoundException } from '@nestjs/common';
import { SuspensionEstablecimientoService } from '../../src/plataforma/suspension-establecimiento.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { KeycloakAdminService } from '../../src/keycloak-admin/keycloak-admin.service';
import { TenantEstadoService } from '../../src/tenant-estado/tenant-estado.service';
import { AuditLogService } from '../../src/audit-log/audit-log.service';
import { AuditAction } from '../../src/audit-log/audit-action.enum';

/**
 * BL-413: suspender y reactivar un establecimiento. La base, Keycloak, la
 * caché del estado y la auditoría se simulan.
 */

const TENANT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const OTRO_TENANT_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const ACTOR = { id: 'kc-plataforma-1' };
const AHORA = new Date('2026-10-24T12:00:00Z');

const usuarioKc = (id: string, tenantId: string) => ({
  id,
  username: id,
  attributes: { tenant_id: [tenantId] },
});

describe('SuspensionEstablecimientoService (BL-413)', () => {
  let contextos: string[];
  let tx: any;
  let keycloak: {
    listarUsuariosDelTenant: jest.Mock;
    logoutUser: jest.Mock;
  };
  let tenantEstado: { invalidar: jest.Mock };
  let auditLog: { registrar: jest.Mock };
  let service: SuspensionEstablecimientoService;

  beforeEach(() => {
    contextos = [];
    tx = {
      tenant: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: TENANT_ID }),
      },
      pedido: { count: jest.fn().mockResolvedValue(3) },
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
          usuarioKc('kc-ajeno', OTRO_TENANT_ID),
        ]),
      logoutUser: jest.fn().mockResolvedValue(true),
    };
    tenantEstado = { invalidar: jest.fn() };
    auditLog = { registrar: jest.fn() };
    service = new SuspensionEstablecimientoService(
      tenantPrisma as unknown as TenantPrismaService,
      keycloak as unknown as KeycloakAdminService,
      tenantEstado as unknown as TenantEstadoService,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('suspender', () => {
    it('[TC-U-132] pasa a SUSPENDIDO solo un tenant ACTIVO, con fecha y motivo, dentro de su contexto', async () => {
      await service.suspender(TENANT_ID, 'Falta de pago', ACTOR, AHORA);

      expect(contextos).toEqual([TENANT_ID]);
      expect(tx.tenant.updateMany).toHaveBeenCalledWith({
        where: { id: TENANT_ID, estado: 'ACTIVO' },
        data: {
          estado: 'SUSPENDIDO',
          suspendidoEn: AHORA,
          motivoSuspension: 'Falta de pago',
        },
      });
    });

    it('[TC-U-133] invalida la caché del estado y cierra las sesiones solo de los usuarios de ese tenant', async () => {
      await service.suspender(TENANT_ID, 'Falta de pago', ACTOR, AHORA);

      expect(tenantEstado.invalidar).toHaveBeenCalledWith(TENANT_ID);
      expect(keycloak.listarUsuariosDelTenant).toHaveBeenCalledWith(TENANT_ID);
      expect(keycloak.logoutUser).toHaveBeenCalledTimes(2);
      expect(keycloak.logoutUser).toHaveBeenCalledWith('kc-admin');
      expect(keycloak.logoutUser).toHaveBeenCalledWith('kc-cocina');
      expect(keycloak.logoutUser).not.toHaveBeenCalledWith('kc-ajeno');
    });

    it('[TC-U-134] audita con el motivo, los pedidos abiertos y las sesiones cerradas', async () => {
      keycloak.logoutUser
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await service.suspender(TENANT_ID, 'Falta de pago', ACTOR, AHORA);

      expect(tx.pedido.count).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          estado: { in: ['RECIBIDO', 'EN_PREPARACION', 'LISTO_PARA_ENTREGAR'] },
        },
      });
      expect(auditLog.registrar).toHaveBeenCalledWith({
        action: AuditAction.ESTABLECIMIENTO_SUSPENDIDO,
        tenantId: TENANT_ID,
        actorKeycloakId: ACTOR.id,
        targetUsuarioId: TENANT_ID,
        detalle: {
          motivo: 'Falta de pago',
          pedidosAbiertos: 3,
          sesiones: { cerradas: 1, sinCerrar: 1 },
        },
      });
    });

    it('[TC-U-135] si Keycloak no responde, la suspensión queda hecha y se audita igual', async () => {
      keycloak.listarUsuariosDelTenant.mockRejectedValue(
        new Error('Keycloak caído'),
      );

      await expect(
        service.suspender(TENANT_ID, 'Falta de pago', ACTOR, AHORA),
      ).resolves.toBeUndefined();

      expect(tenantEstado.invalidar).toHaveBeenCalledWith(TENANT_ID);
      expect(auditLog.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          detalle: expect.objectContaining({
            sesiones: { cerradas: 0, sinCerrar: null },
          }),
        }),
      );
    });

    it('[TC-U-136] ya suspendido: 409, sin invalidar, cerrar sesiones ni auditar', async () => {
      tx.tenant.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.suspender(TENANT_ID, 'Falta de pago', ACTOR, AHORA),
      ).rejects.toThrow(ConflictException);

      expect(tenantEstado.invalidar).not.toHaveBeenCalled();
      expect(keycloak.logoutUser).not.toHaveBeenCalled();
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('inexistente: 404', async () => {
      tx.tenant.updateMany.mockResolvedValue({ count: 0 });
      tx.tenant.findUnique.mockResolvedValue(null);

      await expect(
        service.suspender(TENANT_ID, 'Falta de pago', ACTOR, AHORA),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reactivar', () => {
    it('[TC-U-137] vuelve a ACTIVO solo un tenant SUSPENDIDO, limpia fecha y motivo, invalida la caché y audita', async () => {
      await service.reactivar(TENANT_ID, ACTOR);

      expect(contextos).toEqual([TENANT_ID]);
      expect(tx.tenant.updateMany).toHaveBeenCalledWith({
        where: { id: TENANT_ID, estado: 'SUSPENDIDO' },
        data: { estado: 'ACTIVO', suspendidoEn: null, motivoSuspension: null },
      });
      expect(tenantEstado.invalidar).toHaveBeenCalledWith(TENANT_ID);
      expect(auditLog.registrar).toHaveBeenCalledWith({
        action: AuditAction.ESTABLECIMIENTO_REACTIVADO,
        tenantId: TENANT_ID,
        actorKeycloakId: ACTOR.id,
        targetUsuarioId: TENANT_ID,
      });
      // Reactivar no toca las cuentas: entran con su contraseña de siempre.
      expect(keycloak.logoutUser).not.toHaveBeenCalled();
    });

    it('[TC-U-138] uno que no está suspendido: 409; uno inexistente: 404', async () => {
      tx.tenant.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.reactivar(TENANT_ID, ACTOR)).rejects.toThrow(
        ConflictException,
      );

      tx.tenant.findUnique.mockResolvedValue(null);
      await expect(service.reactivar(TENANT_ID, ACTOR)).rejects.toThrow(
        NotFoundException,
      );
      expect(auditLog.registrar).not.toHaveBeenCalled();
      expect(tenantEstado.invalidar).not.toHaveBeenCalled();
    });
  });
});
