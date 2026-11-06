import 'reflect-metadata';
import { MesaEstado } from '@prisma/client';
import {
  LimpiezaMesasService,
  accionParaMesa,
  planoSinZonasE2E,
} from '../../src/testing/limpieza-mesas.service';
import { LimpiezaPruebasController } from '../../src/testing/limpieza-pruebas.controller';
import { MESAS_DEL_SEED } from '../../src/testing/datos-seed';
import { AuditAction } from '../../src/audit-log/audit-action.enum';

// BL-479 (BL-285, ADR 0011): mesas y plano como el seed.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR = 'kc-admin-1';
const [MESA_1, MESA_2] = MESAS_DEL_SEED;

function mesa(
  id: string,
  numero: number,
  estado: MesaEstado,
  pedidos = 0,
  sesionId: string | null = estado === MesaEstado.LIBRE ? null : `s-${id}`,
) {
  return { id, numero, estado, sesionId, _count: { pedidos } };
}

describe('accionParaMesa y planoSinZonasE2E', () => {
  it('[TC-U-435] mesas del seed quedan abiertas; temporales (50 a 99) se eliminan; el resto, LIBRE', () => {
    expect(
      accionParaMesa({ id: MESA_1, numero: 1, estado: MesaEstado.OCUPADA }),
    ).toBe('nada');
    expect(
      accionParaMesa({ id: MESA_1, numero: 1, estado: MesaEstado.LIBRE }),
    ).toBe('reabrir');
    expect(
      accionParaMesa({
        id: MESA_2,
        numero: 2,
        estado: MesaEstado.REQUIERE_LIMPIEZA,
      }),
    ).toBe('reabrir');
    expect(
      accionParaMesa({
        id: MESA_2,
        numero: 2,
        estado: MesaEstado.EN_PROCESO_DE_PAGO,
      }),
    ).toBe('pasarAOcupada');
    for (const numero of [50, 77, 99]) {
      expect(
        accionParaMesa({ id: 'x', numero, estado: MesaEstado.LIBRE }),
      ).toBe('eliminar');
    }
    expect(
      accionParaMesa({ id: 'x', numero: 3, estado: MesaEstado.OCUPADA }),
    ).toBe('liberar');
    expect(
      accionParaMesa({ id: 'x', numero: 49, estado: MesaEstado.LIBRE }),
    ).toBe('nada');
    expect(
      accionParaMesa({ id: 'x', numero: 100, estado: MesaEstado.LIBRE }),
    ).toBe('nada');
  });

  it('[TC-U-436] el plano pierde solo las zonas «Zona E2E …»; sin ninguna, no cambia', () => {
    const plano = {
      elementos: [{ id: 'e1', tipo: 'PUERTA' }],
      zonas: [
        { id: 'z1', etiqueta: 'Salón' },
        { id: 'z2', etiqueta: 'Zona E2E 12345' },
        { id: 'z3', etiqueta: 'Zona E2E 678' },
        { id: 'z4' },
      ],
    };
    expect(planoSinZonasE2E(plano)).toEqual({
      plano: {
        elementos: [{ id: 'e1', tipo: 'PUERTA' }],
        zonas: [{ id: 'z1', etiqueta: 'Salón' }, { id: 'z4' }],
      },
      quitadas: 2,
    });
    expect(planoSinZonasE2E({ zonas: [{ etiqueta: 'Patio' }] })).toBeNull();
    expect(planoSinZonasE2E(null)).toBeNull();
    expect(planoSinZonasE2E({ elementos: [] })).toBeNull();
    expect(planoSinZonasE2E('no es un plano')).toBeNull();
  });
});

describe('LimpiezaMesasService', () => {
  let tx: {
    mesa: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
    restaurante: { findMany: jest.Mock; update: jest.Mock };
    sesionMesa: { updateMany: jest.Mock; create: jest.Mock };
  };
  let auditLog: { registrarEnTx: jest.Mock };
  let service: LimpiezaMesasService;

  beforeEach(() => {
    tx = {
      mesa: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      restaurante: {
        findMany: jest.fn().mockResolvedValue([{ id: 'r1', plano: null }]),
        update: jest.fn(),
      },
      sesionMesa: { updateMany: jest.fn(), create: jest.fn() },
    };
    auditLog = { registrarEnTx: jest.fn() };
    const tenantPrisma = {
      runInTenantContext: jest.fn((_t: string, fn: any) => fn(tx)),
    };
    service = new LimpiezaMesasService(tenantPrisma as any, auditLog as any);
  });

  const escenario = () => {
    tx.mesa.findMany.mockResolvedValue([
      mesa(MESA_1, 1, MesaEstado.REQUIERE_LIMPIEZA, 3, null),
      mesa(MESA_2, 2, MesaEstado.EN_PROCESO_DE_PAGO, 1),
      mesa('m3', 3, MesaEstado.OCUPADA),
      mesa('m4', 4, MesaEstado.LIBRE),
      mesa('t60', 60, MesaEstado.OCUPADA),
      mesa('t70', 70, MesaEstado.REQUIERE_LIMPIEZA, 2, null),
    ]);
    tx.restaurante.findMany.mockResolvedValue([
      {
        id: 'r1',
        plano: { elementos: [], zonas: [{ etiqueta: 'Zona E2E 1' }] },
      },
    ]);
  };

  it('[TC-U-437] dry-run cuenta lo que haría sin cambiar nada (la mesa virtual queda afuera)', async () => {
    escenario();

    const resultado = await service.limpiar(TENANT_ID, ACTOR, true);

    expect(tx.mesa.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { esVirtual: false } }),
    );
    expect(resultado).toEqual({
      reabiertas: 2,
      liberadas: 2, // m3 y la temporal 70 (tiene pedidos)
      eliminadas: 1, // temporal 60
      temporalesConPedidos: 1,
      zonasEliminadas: 1,
      cambios: [],
      mesasDelSalon: [MESA_1, MESA_2, 'm3', 'm4', 't60', 't70'],
    });
    expect(tx.mesa.updateMany).not.toHaveBeenCalled();
    expect(tx.mesa.deleteMany).not.toHaveBeenCalled();
    expect(tx.restaurante.update).not.toHaveBeenCalled();
    expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
  });

  it('[TC-U-438] cierra sesiones, libera, elimina temporales sin pedidos, reabre las del seed y quita zonas', async () => {
    escenario();

    const resultado = await service.limpiar(TENANT_ID, ACTOR, false);

    // Sesiones cerradas en el historial: m3 y t60 (las que tenían sesión).
    expect(tx.sesionMesa.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['s-m3', 's-t60'] }, cerradaEn: null },
      data: { cerradaEn: expect.any(Date) },
    });
    expect(tx.mesa.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m3', 't70', 't60'] } },
      data: {
        estado: MesaEstado.LIBRE,
        sesionId: null,
        sesionAbiertaEn: null,
      },
    });
    expect(tx.mesa.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['t60'] } },
    });
    // Mesa 1: sesión nueva y su fila en el historial.
    expect(tx.mesa.update).toHaveBeenCalledWith({
      where: { id: MESA_1 },
      data: {
        estado: MesaEstado.OCUPADA,
        sesionId: expect.any(String),
        sesionAbiertaEn: expect.any(Date),
      },
    });
    const sesionNueva = tx.mesa.update.mock.calls[0][0].data.sesionId;
    expect(tx.sesionMesa.create).toHaveBeenCalledWith({
      data: {
        id: sesionNueva,
        tenantId: TENANT_ID,
        mesaId: MESA_1,
        abiertaEn: expect.any(Date),
      },
    });
    // Mesa 2: sigue con su sesión, deja de estar en proceso de pago.
    expect(tx.mesa.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [MESA_2] } },
      data: { estado: MesaEstado.OCUPADA },
    });
    expect(tx.restaurante.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { plano: { elementos: [], zonas: [] } },
    });
    expect(auditLog.registrarEnTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: AuditAction.MESA_LIMPIEZA_PRUEBAS,
        tenantId: TENANT_ID,
        actorKeycloakId: ACTOR,
        detalle: expect.objectContaining({
          eliminadas: 1,
          mesasEliminadas: [60],
        }),
      }),
    );
    expect(resultado.cambios).toEqual([
      { mesaId: 'm3', estado: MesaEstado.LIBRE },
      { mesaId: 't70', estado: MesaEstado.LIBRE },
      { mesaId: MESA_1, estado: MesaEstado.OCUPADA },
      { mesaId: MESA_2, estado: MesaEstado.OCUPADA },
    ]);
    // La temporal borrada ya no está en el salón.
    expect(resultado.mesasDelSalon).toEqual([
      MESA_1,
      MESA_2,
      'm3',
      'm4',
      't70',
    ]);
  });

  it('[TC-U-439] con todo como el seed no escribe nada', async () => {
    tx.mesa.findMany.mockResolvedValue([
      mesa(MESA_1, 1, MesaEstado.OCUPADA),
      mesa('m4', 4, MesaEstado.LIBRE),
    ]);

    const resultado = await service.limpiar(TENANT_ID, ACTOR, false);

    expect(resultado).toEqual({
      reabiertas: 0,
      liberadas: 0,
      eliminadas: 0,
      temporalesConPedidos: 0,
      zonasEliminadas: 0,
      cambios: [],
      mesasDelSalon: [MESA_1, 'm4'],
    });
    expect(tx.mesa.updateMany).not.toHaveBeenCalled();
    expect(tx.sesionMesa.updateMany).not.toHaveBeenCalled();
    expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
  });
});

describe('LimpiezaPruebasController · área mesas', () => {
  const req = { user: { sub: ACTOR, tenantId: TENANT_ID, roles: ['ADMIN'] } };
  const resumenMesas = {
    reabiertas: 1,
    liberadas: 1,
    eliminadas: 0,
    temporalesConPedidos: 0,
    zonasEliminadas: 0,
  };

  function armar() {
    const limpieza = {
      limpiar: jest.fn().mockResolvedValue({
        encontrados: {},
        cancelados: 0,
        entregados: 0,
        cerrados: [],
      }),
    };
    const limpiezaMesas = {
      limpiar: jest.fn().mockResolvedValue({
        ...resumenMesas,
        cambios: [
          { mesaId: 'm3', estado: MesaEstado.LIBRE },
          { mesaId: MESA_1, estado: MesaEstado.OCUPADA },
        ],
        mesasDelSalon: [MESA_1, 'm3'],
      }),
    };
    const kdsGateway = {
      emitirPedidoActualizado: jest.fn(),
      emitirLlamadoResuelto: jest.fn(),
      emitirEstadoMesa: jest.fn(),
      avisarEstadoCola: jest.fn(),
    };
    const controller = new LimpiezaPruebasController(
      limpieza as any,
      limpiezaMesas as any,
      kdsGateway as any,
    );
    return { controller, limpieza, limpiezaMesas, kdsGateway };
  }

  it('[TC-U-440] sin áreas limpia pedidos y después mesas; avisa el estado de cada mesa y saca las alertas del salón', async () => {
    const { controller, limpieza, limpiezaMesas, kdsGateway } = armar();

    const respuesta = await controller.limpiar(req as any, {});

    expect(limpieza.limpiar.mock.invocationCallOrder[0]).toBeLessThan(
      limpiezaMesas.limpiar.mock.invocationCallOrder[0],
    );
    expect(limpiezaMesas.limpiar).toHaveBeenCalledWith(TENANT_ID, ACTOR, false);
    expect(respuesta).toEqual({
      dryRun: false,
      pedidos: { encontrados: {}, cancelados: 0, entregados: 0 },
      mesas: resumenMesas,
    });
    expect(kdsGateway.emitirEstadoMesa).toHaveBeenCalledWith(
      TENANT_ID,
      'm3',
      MesaEstado.LIBRE,
    );
    expect(kdsGateway.emitirEstadoMesa).toHaveBeenCalledWith(
      TENANT_ID,
      MESA_1,
      MesaEstado.OCUPADA,
    );
    expect(kdsGateway.emitirLlamadoResuelto).toHaveBeenCalledTimes(2);
  });

  it('[TC-U-441] en dry-run no avisa nada; con solo el área mesas no toca los pedidos', async () => {
    const { controller, limpieza, limpiezaMesas, kdsGateway } = armar();

    const respuesta = await controller.limpiar(req as any, {
      areas: ['mesas'],
      dryRun: true,
    });

    expect(limpieza.limpiar).not.toHaveBeenCalled();
    expect(limpiezaMesas.limpiar).toHaveBeenCalledWith(TENANT_ID, ACTOR, true);
    expect(respuesta).toEqual({ dryRun: true, mesas: resumenMesas });
    expect(kdsGateway.emitirEstadoMesa).not.toHaveBeenCalled();
    expect(kdsGateway.emitirLlamadoResuelto).not.toHaveBeenCalled();
  });
});
