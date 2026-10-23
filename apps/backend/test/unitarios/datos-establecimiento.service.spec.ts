import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatosEstablecimientoService } from '../../src/plataforma/datos-establecimiento.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { AuditLogService } from '../../src/audit-log/audit-log.service';
import { AuditAction } from '../../src/audit-log/audit-action.enum';

/**
 * BL-412: corregir los datos de un establecimiento. Mismo servicio para la
 * plataforma y para HU-020 (ADMIN), con el reparto de la propuesta: el RUT y
 * el plan solo los cambia PLATAFORMA.
 */

const TENANT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const OTRO_TENANT_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const ACTOR = { id: 'kc-plataforma-1' };
const RUT_ACTUAL = '219999990016';
const RUT_NUEVO = '211234560019';

describe('DatosEstablecimientoService (BL-412)', () => {
  let contextos: string[];
  let tx: any;
  let auditLog: { registrar: jest.Mock };
  let service: DatosEstablecimientoService;

  beforeEach(() => {
    contextos = [];
    tx = {
      tenant: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(
            where.id
              ? { razonSocial: 'Uno SRL', rut: RUT_ACTUAL, plan: 'BASICO' }
              : null, // búsqueda por RUT: nadie lo tiene
          ),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      restaurante: {
        findUnique: jest.fn().mockResolvedValue({
          nombre: 'Restaurante Uno',
          direccion: 'Calle 1',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const tenantPrisma = {
      runInTenantContext: jest.fn((tenantId: string, fn: any) => {
        contextos.push(tenantId);
        return fn(tx);
      }),
    };
    auditLog = { registrar: jest.fn() };
    service = new DatosEstablecimientoService(
      tenantPrisma as unknown as TenantPrismaService,
      auditLog as unknown as AuditLogService,
    );
  });

  it('cambia la razón social del tenant dentro de su contexto y lo audita sin valores', async () => {
    const campos = await service.actualizar(
      TENANT_ID,
      { razonSocial: 'Uno y Cía SRL' },
      ACTOR,
      'PLATAFORMA',
    );

    expect(campos).toEqual(['razonSocial']);
    expect(contextos).toEqual([TENANT_ID]);
    expect(tx.tenant.update).toHaveBeenCalledWith({
      where: { id: TENANT_ID },
      data: { razonSocial: 'Uno y Cía SRL' },
    });
    expect(tx.restaurante.update).not.toHaveBeenCalled();
    expect(auditLog.registrar).toHaveBeenCalledWith({
      action: AuditAction.ESTABLECIMIENTO_DATOS_MODIFICADOS,
      tenantId: TENANT_ID,
      actorKeycloakId: ACTOR.id,
      targetUsuarioId: TENANT_ID,
      detalle: { campos: ['razonSocial'], origen: 'PLATAFORMA' },
    });
    expect(JSON.stringify(auditLog.registrar.mock.calls)).not.toContain(
      'Uno y Cía',
    );
  });

  it('cambia el nombre y la dirección del restaurante', async () => {
    const campos = await service.actualizar(
      TENANT_ID,
      { restauranteNombre: 'Uno Bistró', restauranteDireccion: 'Calle 2' },
      ACTOR,
      'PLATAFORMA',
    );

    expect(campos).toEqual(['restauranteNombre', 'restauranteDireccion']);
    expect(tx.restaurante.update).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
      data: { nombre: 'Uno Bistró', direccion: 'Calle 2' },
    });
    expect(tx.tenant.update).not.toHaveBeenCalled();
  });

  it('cambia el RUT si no es de otro establecimiento', async () => {
    const campos = await service.actualizar(
      TENANT_ID,
      { rut: RUT_NUEVO },
      ACTOR,
      'PLATAFORMA',
    );

    expect(campos).toEqual(['rut']);
    expect(tx.tenant.findUnique).toHaveBeenCalledWith({
      where: { rut: RUT_NUEVO },
      select: { id: true },
    });
    expect(tx.tenant.update).toHaveBeenCalledWith({
      where: { id: TENANT_ID },
      data: { rut: RUT_NUEVO },
    });
  });

  it('RUT de otro establecimiento: 409 sin escribir ni auditar', async () => {
    tx.tenant.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.id
          ? { razonSocial: 'Uno SRL', rut: RUT_ACTUAL, plan: 'BASICO' }
          : { id: OTRO_TENANT_ID },
      ),
    );

    await expect(
      service.actualizar(TENANT_ID, { rut: RUT_NUEVO }, ACTOR, 'PLATAFORMA'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.tenant.update).not.toHaveBeenCalled();
    expect(auditLog.registrar).not.toHaveBeenCalled();
  });

  it('dos ediciones con el mismo RUT a la vez: el índice único da 409', async () => {
    tx.tenant.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '0.0.0',
      }),
    );

    await expect(
      service.actualizar(TENANT_ID, { rut: RUT_NUEVO }, ACTOR, 'PLATAFORMA'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('el mismo valor no cuenta como cambio: no escribe ni audita', async () => {
    const campos = await service.actualizar(
      TENANT_ID,
      { razonSocial: 'Uno SRL', rut: RUT_ACTUAL, plan: 'BASICO' },
      ACTOR,
      'PLATAFORMA',
    );

    expect(campos).toEqual([]);
    expect(tx.tenant.update).not.toHaveBeenCalled();
    expect(auditLog.registrar).not.toHaveBeenCalled();
  });

  it('sin ningún campo: 400 «No hay cambios», sin consultar la base', async () => {
    await expect(
      service.actualizar(TENANT_ID, {}, ACTOR, 'PLATAFORMA'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(contextos).toEqual([]);
  });

  it('tenant inexistente: 404', async () => {
    tx.tenant.findUnique.mockResolvedValue(null);

    await expect(
      service.actualizar(TENANT_ID, { plan: 'PRO' }, ACTOR, 'PLATAFORMA'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('datos del restaurante en un alta sin restaurante: 409', async () => {
    tx.restaurante.findUnique.mockResolvedValue(null);

    await expect(
      service.actualizar(
        TENANT_ID,
        { restauranteNombre: 'Uno' },
        ACTOR,
        'PLATAFORMA',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.restaurante.update).not.toHaveBeenCalled();
  });

  it('cambia el plan', async () => {
    const campos = await service.actualizar(
      TENANT_ID,
      { plan: 'PRO' },
      ACTOR,
      'PLATAFORMA',
    );

    expect(campos).toEqual(['plan']);
    expect(tx.tenant.update).toHaveBeenCalledWith({
      where: { id: TENANT_ID },
      data: { plan: 'PRO' },
    });
    expect(tx.restaurante.findUnique).not.toHaveBeenCalled();
  });

  it('un error de la base que no es de RUT duplicado se propaga tal cual', async () => {
    const error = new Error('conexión perdida');
    tx.tenant.update.mockRejectedValue(error);

    await expect(
      service.actualizar(TENANT_ID, { plan: 'PRO' }, ACTOR, 'PLATAFORMA'),
    ).rejects.toBe(error);
    expect(auditLog.registrar).not.toHaveBeenCalled();
  });

  it('HU-020: el ADMIN no puede cambiar el RUT ni el plan (403)', async () => {
    await expect(
      service.actualizar(TENANT_ID, { rut: RUT_NUEVO }, ACTOR, 'ADMIN'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.actualizar(TENANT_ID, { plan: 'PRO' }, ACTOR, 'ADMIN'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(contextos).toEqual([]);
  });

  it('HU-020: el ADMIN sí puede cambiar la razón social y el restaurante', async () => {
    const campos = await service.actualizar(
      TENANT_ID,
      { razonSocial: 'Uno y Cía SRL', restauranteNombre: 'Uno Bistró' },
      ACTOR,
      'ADMIN',
    );

    expect(campos).toEqual(['razonSocial', 'restauranteNombre']);
    expect(auditLog.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        detalle: {
          campos: ['razonSocial', 'restauranteNombre'],
          origen: 'ADMIN',
        },
      }),
    );
  });
});
