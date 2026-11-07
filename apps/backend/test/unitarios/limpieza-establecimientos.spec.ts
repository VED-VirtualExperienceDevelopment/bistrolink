import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  LimpiezaEstablecimientosService,
  accionParaEstablecimiento,
} from '../../src/testing/limpieza-establecimientos.service';
import {
  LimpiarEstablecimientosDto,
  LimpiezaEstablecimientosController,
} from '../../src/testing/limpieza-establecimientos.controller';
import {
  MOTIVO_SUSPENSION_E2E,
  TENANTS_DE_TESTING,
} from '../../src/testing/datos-seed';

// BL-482 (BL-285, ADR 0011): establecimientos creados por los E2E de
// plataforma.

const ACTOR = 'kc-plataforma-1';

const establecimiento = (id: string, estado = 'ACTIVO') => ({
  id,
  rut: `rut-${id}`,
  estado,
});

describe('accionParaEstablecimiento', () => {
  it('[TC-U-458] sin pedidos se elimina; con pedidos se suspende (o nada si ya está suspendido)', () => {
    expect(accionParaEstablecimiento({ estado: 'ACTIVO' }, false)).toBe(
      'eliminar',
    );
    expect(accionParaEstablecimiento({ estado: 'SUSPENDIDO' }, false)).toBe(
      'eliminar',
    );
    expect(accionParaEstablecimiento({ estado: 'ACTIVO' }, true)).toBe(
      'suspender',
    );
    expect(accionParaEstablecimiento({ estado: 'SUSPENDIDO' }, true)).toBe(
      'nada',
    );
  });
});

describe('LimpiezaEstablecimientosService', () => {
  function armar(
    encontrados: ReturnType<typeof establecimiento>[],
    conPedidos: string[] = [],
  ) {
    const findMany = jest.fn().mockResolvedValue(encontrados);
    const tenantPrisma = {
      runInTenantContext: jest.fn((tenantId: string, fn: any) =>
        fn({
          tenant: { findMany },
          pedido: {
            findFirst: jest
              .fn()
              .mockResolvedValue(
                conPedidos.includes(tenantId) ? { id: 'p1' } : null,
              ),
          },
        }),
      ),
    };
    const eliminacion = {
      eliminar: jest.fn().mockResolvedValue({
        tenantId: 'x',
        datosEliminados: true,
        cuentas: { eliminadas: 2, pendientes: [] },
      }),
    };
    const suspension = { suspender: jest.fn().mockResolvedValue(undefined) };
    const service = new LimpiezaEstablecimientosService(
      tenantPrisma as any,
      eliminacion as any,
      suspension as any,
    );
    return { findMany, eliminacion, suspension, service };
  }

  it('[TC-U-459] busca solo «E2E Plataforma …» y nunca los tenants de testing del seed', async () => {
    const { findMany, service } = armar([]);

    await service.limpiar(ACTOR, true);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        razonSocial: { startsWith: 'E2E Plataforma ' },
        id: { notIn: [...TENANTS_DE_TESTING] },
      },
      select: { id: true, rut: true, estado: true },
    });
    expect(TENANTS_DE_TESTING).toEqual([
      '11111111-1111-1111-1111-111111111111',
      'b02579f2-2bb0-496b-abf2-33c494c93122',
    ]);
  });

  it('[TC-U-460] elimina con su RUT los que no tienen pedidos y suspende los que tienen', async () => {
    const { eliminacion, suspension, service } = armar(
      [
        establecimiento('t1'),
        establecimiento('t2'),
        establecimiento('t3', 'SUSPENDIDO'),
      ],
      ['t2', 't3'],
    );

    const resumen = await service.limpiar(ACTOR, false);

    expect(eliminacion.eliminar).toHaveBeenCalledTimes(1);
    expect(eliminacion.eliminar).toHaveBeenCalledWith('t1', 'rut-t1', {
      id: ACTOR,
    });
    expect(suspension.suspender).toHaveBeenCalledTimes(1);
    expect(suspension.suspender).toHaveBeenCalledWith(
      't2',
      MOTIVO_SUSPENSION_E2E,
      { id: ACTOR },
    );
    expect(resumen).toEqual({
      dryRun: false,
      eliminados: 1,
      suspendidos: 1,
      cuentasPendientes: 0,
      conError: 0,
    });
  });

  it('[TC-U-461] dry-run no cambia nada; las cuentas pendientes y los errores se cuentan sin cortar', async () => {
    const enDryRun = armar(
      [establecimiento('t1'), establecimiento('t2')],
      ['t2'],
    );
    expect(await enDryRun.service.limpiar(ACTOR, true)).toEqual({
      dryRun: true,
      eliminados: 1,
      suspendidos: 1,
      cuentasPendientes: 0,
      conError: 0,
    });
    expect(enDryRun.eliminacion.eliminar).not.toHaveBeenCalled();
    expect(enDryRun.suspension.suspender).not.toHaveBeenCalled();

    const conProblemas = armar([
      establecimiento('t1'),
      establecimiento('t2'),
      establecimiento('t3'),
    ]);
    conProblemas.eliminacion.eliminar
      .mockResolvedValueOnce({
        tenantId: 't1',
        datosEliminados: true,
        cuentas: { eliminadas: 1, pendientes: ['e2e-pg-cocina-1'] },
      })
      .mockRejectedValueOnce(new Error('Keycloak no respondió'))
      .mockResolvedValueOnce({
        tenantId: 't3',
        datosEliminados: true,
        cuentas: { eliminadas: 0, pendientes: null },
      });
    expect(await conProblemas.service.limpiar(ACTOR, false)).toEqual({
      dryRun: false,
      eliminados: 2,
      suspendidos: 0,
      cuentasPendientes: 1,
      conError: 1,
    });
  });
});

describe('LimpiezaEstablecimientosController', () => {
  it('[TC-U-462] pasa el usuario de plataforma y el dry-run; el DTO solo acepta dryRun booleano', async () => {
    const limpieza = {
      limpiar: jest.fn().mockResolvedValue({ dryRun: true }),
    };
    const controller = new LimpiezaEstablecimientosController(limpieza as any);

    await controller.limpiar({ user: { sub: ACTOR } } as any, { dryRun: true });
    await controller.limpiar({ user: { sub: ACTOR } } as any, {});

    expect(limpieza.limpiar).toHaveBeenNthCalledWith(1, ACTOR, true);
    expect(limpieza.limpiar).toHaveBeenNthCalledWith(2, ACTOR, false);

    const errores = async (body: Record<string, unknown>) =>
      (await validate(plainToInstance(LimpiarEstablecimientosDto, body))).map(
        (e) => e.property,
      );
    expect(await errores({})).toEqual([]);
    expect(await errores({ dryRun: false })).toEqual([]);
    expect(await errores({ dryRun: 'si' })).toEqual(['dryRun']);
  });
});
