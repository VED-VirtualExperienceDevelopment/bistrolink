import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PedidoEstado } from '@prisma/client';
import {
  LimpiezaPruebasService,
  estadoDeCierre,
} from '../../src/testing/limpieza-pruebas.service';
import { LimpiezaPruebasController } from '../../src/testing/limpieza-pruebas.controller';
import {
  TestingModule,
  modulosDeTesting,
} from '../../src/testing/testing.module';
import {
  LimpiarPedidosDto,
  MAXIMO_PEDIDOS_LIMPIEZA,
} from '../../src/testing/dto/limpiar-pedidos.dto';
import { AuditAction } from '../../src/audit-log/audit-action.enum';

// BL-475 (BL-285): limpieza de los pedidos de prueba (cerrar, no borrar).

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR = 'kc-admin-1';
const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function cerrado(id: string, estado: PedidoEstado, mesa = 'mesa-1') {
  return {
    id,
    estado,
    updatedAt: new Date('2026-11-06T12:00:00.000Z'),
    mesa: { id: mesa, numero: 4 },
    lineas: [{ id: `l-${id}`, nombreSnapshot: 'Flan', cantidad: 1 }],
  };
}

describe('LimpiezaPruebasService', () => {
  let tx: {
    $executeRaw: jest.Mock;
    pedido: { findMany: jest.Mock; updateMany: jest.Mock };
    usuario: { findUnique: jest.Mock };
    pedidoEstadoHistorial: { createMany: jest.Mock };
  };
  let auditLog: { registrarEnTx: jest.Mock };
  let service: LimpiezaPruebasService;

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      pedido: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      usuario: { findUnique: jest.fn().mockResolvedValue({ id: 'u-1' }) },
      pedidoEstadoHistorial: { createMany: jest.fn() },
    };
    auditLog = { registrarEnTx: jest.fn() };
    const tenantPrisma = {
      runInTenantContext: jest.fn((_t: string, fn: any) => fn(tx)),
    };
    service = new LimpiezaPruebasService(tenantPrisma as any, auditLog as any);
  });

  afterEach(() => jest.useRealTimers());

  it('[TC-U-424] estadoDeCierre: sin pagar se cancela; pagado (en cocina o listo) se entrega', () => {
    expect(estadoDeCierre(PedidoEstado.PENDIENTE_PAGO)).toBe(
      PedidoEstado.CANCELADO,
    );
    for (const estado of [
      PedidoEstado.RECIBIDO,
      PedidoEstado.EN_PREPARACION,
      PedidoEstado.LISTO_PARA_ENTREGAR,
    ]) {
      expect(estadoDeCierre(estado)).toBe(PedidoEstado.ENTREGADO);
    }
  });

  it('[TC-U-425] con pedidoIds cierra solo esos, si siguen abiertos, y deja historial y auditoría', async () => {
    tx.pedido.findMany
      .mockResolvedValueOnce([
        { id: UUID_A, estado: PedidoEstado.PENDIENTE_PAGO },
        { id: UUID_B, estado: PedidoEstado.EN_PREPARACION },
      ])
      .mockResolvedValueOnce([
        cerrado(UUID_A, PedidoEstado.CANCELADO),
        cerrado(UUID_B, PedidoEstado.ENTREGADO, 'mesa-2'),
      ]);

    const resultado = await service.limpiar(TENANT_ID, ACTOR, {
      pedidoIds: [UUID_A, UUID_B],
    });

    expect(tx.pedido.findMany.mock.calls[0][0].where).toEqual({
      id: { in: [UUID_A, UUID_B] },
      estado: {
        in: [
          PedidoEstado.PENDIENTE_PAGO,
          PedidoEstado.RECIBIDO,
          PedidoEstado.EN_PREPARACION,
          PedidoEstado.LISTO_PARA_ENTREGAR,
        ],
      },
    });
    expect(tx.pedido.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [UUID_A] } },
      data: { estado: PedidoEstado.CANCELADO },
    });
    expect(tx.pedido.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [UUID_B] } },
      data: { estado: PedidoEstado.ENTREGADO },
    });
    expect(tx.pedidoEstadoHistorial.createMany).toHaveBeenCalledWith({
      data: [
        {
          tenantId: TENANT_ID,
          pedidoId: UUID_A,
          usuarioId: 'u-1',
          estadoAnterior: PedidoEstado.PENDIENTE_PAGO,
          estadoNuevo: PedidoEstado.CANCELADO,
        },
        {
          tenantId: TENANT_ID,
          pedidoId: UUID_B,
          usuarioId: 'u-1',
          estadoAnterior: PedidoEstado.EN_PREPARACION,
          estadoNuevo: PedidoEstado.ENTREGADO,
        },
      ],
    });
    expect(auditLog.registrarEnTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: AuditAction.PEDIDO_LIMPIEZA_PRUEBAS,
        tenantId: TENANT_ID,
        actorKeycloakId: ACTOR,
        detalle: expect.objectContaining({
          cancelados: 1,
          entregados: 1,
          pedidos: [UUID_A, UUID_B],
        }),
      }),
    );
    expect(resultado).toEqual({
      encontrados: {
        [PedidoEstado.PENDIENTE_PAGO]: 1,
        [PedidoEstado.EN_PREPARACION]: 1,
      },
      cancelados: 1,
      entregados: 1,
      cerrados: [
        expect.objectContaining({
          id: UUID_A,
          estado: PedidoEstado.CANCELADO,
          mesaId: 'mesa-1',
          mesaNumero: 4,
          actualizadoEn: '2026-11-06T12:00:00.000Z',
        }),
        expect.objectContaining({
          id: UUID_B,
          estado: PedidoEstado.ENTREGADO,
          mesaId: 'mesa-2',
        }),
      ],
    });
  });

  it('[TC-U-426] toma el lock de la cola del tenant antes de leer los pedidos', async () => {
    await service.limpiar(TENANT_ID, ACTOR, {});

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.pedido.findMany.mock.invocationCallOrder[0],
    );
  });

  it('[TC-U-427] sin pedidoIds usa la antigüedad (24 h por defecto; 0 = todos los abiertos)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-06T12:00:00.000Z'));

    await service.limpiar(TENANT_ID, ACTOR, {});
    expect(tx.pedido.findMany.mock.calls[0][0].where.createdAt).toEqual({
      lte: new Date('2026-11-05T12:00:00.000Z'),
    });

    await service.limpiar(TENANT_ID, ACTOR, { antiguedadHoras: 0 });
    expect(tx.pedido.findMany.mock.calls[1][0].where.createdAt).toEqual({
      lte: new Date('2026-11-06T12:00:00.000Z'),
    });
  });

  it('[TC-U-428] dryRun cuenta lo que cerraría sin tomar el lock ni cambiar nada', async () => {
    tx.pedido.findMany.mockResolvedValueOnce([
      { id: UUID_A, estado: PedidoEstado.PENDIENTE_PAGO },
      { id: UUID_B, estado: PedidoEstado.RECIBIDO },
    ]);

    const resultado = await service.limpiar(TENANT_ID, ACTOR, {
      antiguedadHoras: 0,
      dryRun: true,
    });

    expect(resultado).toEqual({
      encontrados: {
        [PedidoEstado.PENDIENTE_PAGO]: 1,
        [PedidoEstado.RECIBIDO]: 1,
      },
      cancelados: 1,
      entregados: 1,
      cerrados: [],
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.pedido.updateMany).not.toHaveBeenCalled();
    expect(tx.pedidoEstadoHistorial.createMany).not.toHaveBeenCalled();
    expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
  });

  it('[TC-U-429] sin pedidos abiertos no escribe nada; sin fila de Usuario el historial va sin usuario', async () => {
    const vacio = await service.limpiar(TENANT_ID, ACTOR, {});
    expect(vacio).toEqual({
      encontrados: {},
      cancelados: 0,
      entregados: 0,
      cerrados: [],
    });
    expect(tx.pedido.updateMany).not.toHaveBeenCalled();
    expect(auditLog.registrarEnTx).not.toHaveBeenCalled();

    tx.usuario.findUnique.mockResolvedValue(null);
    tx.pedido.findMany
      .mockResolvedValueOnce([{ id: UUID_A, estado: PedidoEstado.RECIBIDO }])
      .mockResolvedValueOnce([cerrado(UUID_A, PedidoEstado.ENTREGADO)]);
    await service.limpiar(TENANT_ID, ACTOR, { pedidoIds: [UUID_A] });

    expect(tx.pedido.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.pedidoEstadoHistorial.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ usuarioId: null })],
    });
  });
});

describe('LimpiezaPruebasController', () => {
  const req = { user: { sub: ACTOR, tenantId: TENANT_ID, roles: ['ADMIN'] } };

  function armar(resultado: any) {
    const limpieza = { limpiar: jest.fn().mockResolvedValue(resultado) };
    const kdsGateway = {
      emitirPedidoActualizado: jest.fn(),
      emitirLlamadoResuelto: jest.fn(),
      avisarEstadoCola: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new LimpiezaPruebasController(
      limpieza as any,
      kdsGateway as any,
    );
    return { controller, limpieza, kdsGateway };
  }

  it('[TC-U-430] responde solo los números y avisa a KDS, comensales, alertas de las mesas y cola', async () => {
    const pedido = (id: string, estado: PedidoEstado, mesaId: string) => ({
      id,
      estado,
      actualizadoEn: '2026-11-06T12:00:00.000Z',
      mesaId,
      mesaNumero: 4,
      lineas: [],
    });
    const { controller, limpieza, kdsGateway } = armar({
      encontrados: { PENDIENTE_PAGO: 2, RECIBIDO: 1 },
      cancelados: 2,
      entregados: 1,
      cerrados: [
        pedido(UUID_A, PedidoEstado.CANCELADO, 'mesa-1'),
        pedido('c', PedidoEstado.CANCELADO, 'mesa-1'),
        pedido(UUID_B, PedidoEstado.ENTREGADO, 'mesa-2'),
      ],
    });

    const respuesta = await controller.limpiar(req as any, { dryRun: false });

    expect(limpieza.limpiar).toHaveBeenCalledWith(TENANT_ID, ACTOR, {
      dryRun: false,
    });
    expect(respuesta).toEqual({
      dryRun: false,
      pedidos: {
        encontrados: { PENDIENTE_PAGO: 2, RECIBIDO: 1 },
        cancelados: 2,
        entregados: 1,
      },
    });
    expect(kdsGateway.emitirPedidoActualizado).toHaveBeenCalledTimes(3);
    expect(kdsGateway.emitirPedidoActualizado).toHaveBeenCalledWith(TENANT_ID, {
      id: UUID_B,
      estado: PedidoEstado.ENTREGADO,
      actualizadoEn: '2026-11-06T12:00:00.000Z',
      mesaNumero: 4,
      lineas: [],
    });
    // Una vez por mesa, solo las que tenían un pedido sin pagar.
    expect(kdsGateway.emitirLlamadoResuelto).toHaveBeenCalledTimes(1);
    expect(kdsGateway.emitirLlamadoResuelto).toHaveBeenCalledWith(
      TENANT_ID,
      'mesa-1',
    );
    expect(kdsGateway.avisarEstadoCola).toHaveBeenCalledWith(TENANT_ID);
  });

  it('[TC-U-431] sin pedidos cerrados (o en dry-run) no emite eventos', async () => {
    const { controller, kdsGateway } = armar({
      encontrados: { RECIBIDO: 1 },
      cancelados: 0,
      entregados: 1,
      cerrados: [],
    });

    await controller.limpiar(req as any, { dryRun: true });

    expect(kdsGateway.emitirPedidoActualizado).not.toHaveBeenCalled();
    expect(kdsGateway.emitirLlamadoResuelto).not.toHaveBeenCalled();
    expect(kdsGateway.avisarEstadoCola).not.toHaveBeenCalled();
  });

  it('[TC-U-434] sin el área pedidos no la limpia; responde solo las áreas pedidas', async () => {
    const { controller, limpieza } = armar({
      encontrados: {},
      cancelados: 0,
      entregados: 0,
      cerrados: [],
    });

    const respuesta = await controller.limpiar(req as any, {
      areas: [],
      dryRun: true,
    });

    expect(limpieza.limpiar).not.toHaveBeenCalled();
    expect(respuesta).toEqual({ dryRun: true });
  });
});

describe('TestingModule y LimpiarPedidosDto', () => {
  it('[TC-U-432] el módulo solo se registra con E2E_CLEANUP_ENABLED=true', () => {
    expect(modulosDeTesting({ E2E_CLEANUP_ENABLED: 'true' })).toEqual([
      TestingModule,
    ]);
    expect(modulosDeTesting({})).toEqual([]);
    expect(modulosDeTesting({ E2E_CLEANUP_ENABLED: 'false' })).toEqual([]);
    expect(modulosDeTesting({ E2E_CLEANUP_ENABLED: '1' })).toEqual([]);
  });

  async function errores(body: Record<string, unknown>) {
    const dto = plainToInstance(LimpiarPedidosDto, body);
    return (await validate(dto)).map((e) => e.property);
  }

  it('[TC-U-433] el DTO acepta áreas conocidas, ids UUID, antigüedad de 0 a 720 h y dryRun; rechaza el resto', async () => {
    expect(await errores({})).toEqual([]);
    expect(
      await errores({ pedidoIds: [UUID_A], antiguedadHoras: 0, dryRun: true }),
    ).toEqual([]);
    expect(await errores({ antiguedadHoras: 720 })).toEqual([]);

    expect(await errores({ pedidoIds: ['no-es-uuid'] })).toEqual(['pedidoIds']);
    expect(await errores({ pedidoIds: UUID_A })).toEqual(['pedidoIds']);
    expect(
      await errores({
        pedidoIds: Array.from(
          { length: MAXIMO_PEDIDOS_LIMPIEZA + 1 },
          () => UUID_A,
        ),
      }),
    ).toEqual(['pedidoIds']);
    expect(await errores({ antiguedadHoras: -1 })).toEqual(['antiguedadHoras']);
    expect(await errores({ antiguedadHoras: 721 })).toEqual([
      'antiguedadHoras',
    ]);
    expect(await errores({ antiguedadHoras: 1.5 })).toEqual([
      'antiguedadHoras',
    ]);
    expect(await errores({ dryRun: 'si' })).toEqual(['dryRun']);
    expect(await errores({ areas: ['pedidos'] })).toEqual([]);
    expect(await errores({ areas: ['otra'] })).toEqual(['areas']);
    expect(await errores({ areas: 'pedidos' })).toEqual(['areas']);
  });
});
