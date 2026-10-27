import { Logger } from '@nestjs/common';
import { ConciliacionPagosService } from '../../src/pagos/conciliacion/conciliacion-pagos.service';

// HU-032 (BL-202): vencimiento y conciliación de pagos pendientes.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const AHORA = new Date('2026-10-26T12:00:00.000Z');
const MINUTO = 60_000;
const PARAMETROS = {
  conciliarDespuesMs: 2 * MINUTO,
  vencerDespuesMs: 15 * MINUTO,
  lote: 50,
};

function pendiente(minutos: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `pago-${minutos}`,
    medioPago: 'MERCADOPAGO',
    pasarelaReferencia: `ORD-${minutos}`,
    createdAt: new Date(AHORA.getTime() - minutos * MINUTO),
    ...overrides,
  };
}

describe('ConciliacionPagosService (HU-032, BL-202)', () => {
  let tx: {
    pago: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      count: jest.Mock;
    };
    mesa: { updateMany: jest.Mock };
    pagoEstadoHistorial: { create: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let webhook: { procesarOrden: jest.Mock };
  let pedidos: { notificarEstadoMesa: jest.Mock };
  let service: ConciliacionPagosService;

  beforeEach(() => {
    jest.spyOn(Logger, 'warn').mockImplementation();
    jest.spyOn(Logger, 'log').mockImplementation();
    tx = {
      pago: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ pedido: { mesaId: MESA_ID } }),
        count: jest.fn().mockResolvedValue(0),
      },
      mesa: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      pagoEstadoHistorial: { create: jest.fn() },
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_tenantId, callback) => callback(tx)),
    };
    webhook = { procesarOrden: jest.fn().mockResolvedValue('sin_resolver') };
    pedidos = { notificarEstadoMesa: jest.fn() };
    service = new ConciliacionPagosService(
      tenantPrisma as any,
      webhook as any,
      pedidos as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const conciliar = () => service.conciliarTenant(TENANT_ID, PARAMETROS, AHORA);

  it('busca los pendientes con más de 2 minutos, dentro del tenant, de a un lote', async () => {
    await conciliar();

    expect(tenantPrisma.runInTenantContext).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Function),
    );
    expect(tx.pago.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          estado: 'PENDIENTE',
          createdAt: { lt: new Date(AHORA.getTime() - 2 * MINUTO) },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
    );
  });

  it('webhook perdido y la pasarela lo aprobó: se concilia con el flujo del webhook y no vence', async () => {
    tx.pago.findMany.mockResolvedValue([pendiente(5)]);
    webhook.procesarOrden.mockResolvedValue('actualizado');

    const resumen = await conciliar();

    expect(webhook.procesarOrden).toHaveBeenCalledWith('ORD-5', 'CONCILIACION');
    expect(resumen).toEqual({
      revisados: 1,
      conciliados: 1,
      vencidos: 0,
      errores: 0,
    });
    expect(tx.pago.updateMany).not.toHaveBeenCalled();
  });

  it('cobrado de más (requiere reembolso) también cuenta como conciliado', async () => {
    tx.pago.findMany.mockResolvedValue([pendiente(20)]);
    webhook.procesarOrden.mockResolvedValue('requiere_reembolso');

    const resumen = await conciliar();

    expect(resumen.conciliados).toBe(1);
    expect(resumen.vencidos).toBe(0);
  });

  it('sigue pendiente en la pasarela pero todavía no pasaron 15 minutos: no vence', async () => {
    tx.pago.findMany.mockResolvedValue([pendiente(10)]);

    const resumen = await conciliar();

    expect(resumen).toEqual({
      revisados: 1,
      conciliados: 0,
      vencidos: 0,
      errores: 0,
    });
    expect(tx.pago.updateMany).not.toHaveBeenCalled();
  });

  it('sigue pendiente y pasaron 15 minutos: vence (RECHAZADO, VENCIDO) y la mesa vuelve a OCUPADA', async () => {
    tx.pago.findMany.mockResolvedValue([pendiente(16)]);

    const resumen = await conciliar();

    expect(resumen.vencidos).toBe(1);
    expect(tx.pago.updateMany).toHaveBeenCalledWith({
      where: { id: 'pago-16', estado: 'PENDIENTE' },
      data: { estado: 'RECHAZADO', motivoRechazo: 'VENCIDO' },
    });
    expect(tx.pagoEstadoHistorial.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT_ID,
        pagoId: 'pago-16',
        estadoAnterior: 'PENDIENTE',
        estadoNuevo: 'RECHAZADO',
        origen: 'VENCIMIENTO',
        detalle: 'VENCIDO',
      },
    });
    expect(tx.mesa.updateMany).toHaveBeenCalledWith({
      where: { id: MESA_ID, estado: 'EN_PROCESO_DE_PAGO' },
      data: { estado: 'OCUPADA' },
    });
    expect(pedidos.notificarEstadoMesa).toHaveBeenCalledWith(
      TENANT_ID,
      MESA_ID,
      'OCUPADA',
    );
  });

  it('Mercado Pago no responde: cuenta el error y, si ya pasó el plazo, vence igual', async () => {
    tx.pago.findMany.mockResolvedValue([pendiente(30), pendiente(5)]);
    webhook.procesarOrden.mockRejectedValue(new Error('502'));

    const resumen = await conciliar();

    expect(resumen).toEqual({
      revisados: 2,
      conciliados: 0,
      vencidos: 1,
      errores: 2,
    });
    expect(tx.pago.updateMany).toHaveBeenCalledTimes(1);
    expect(Logger.warn).toHaveBeenCalled();
  });

  it('pago sin order (la pasarela no respondió al cobrar): no se consulta, solo vence', async () => {
    tx.pago.findMany.mockResolvedValue([
      pendiente(20, { pasarelaReferencia: null }),
    ]);

    const resumen = await conciliar();

    expect(webhook.procesarOrden).not.toHaveBeenCalled();
    expect(resumen.vencidos).toBe(1);
  });

  it('pago de otro medio (Plexo, fuera del proyecto): no se consulta, solo vence', async () => {
    tx.pago.findMany.mockResolvedValue([
      pendiente(20, { medioPago: 'PLEXO', pasarelaReferencia: 'SES-1' }),
    ]);

    await conciliar();

    expect(webhook.procesarOrden).not.toHaveBeenCalled();
    expect(tx.pago.updateMany).toHaveBeenCalled();
  });

  it('sin pendientes: no hace nada', async () => {
    await expect(conciliar()).resolves.toEqual({
      revisados: 0,
      conciliados: 0,
      vencidos: 0,
      errores: 0,
    });
  });

  describe('vencer', () => {
    it('si el pago ya no estaba PENDIENTE (lo resolvió el webhook), no hace nada', async () => {
      tx.pago.updateMany.mockResolvedValue({ count: 0 });

      expect(await service.vencer(TENANT_ID, 'pago-1')).toBe(false);
      expect(tx.pagoEstadoHistorial.create).not.toHaveBeenCalled();
      expect(tx.mesa.updateMany).not.toHaveBeenCalled();
      expect(pedidos.notificarEstadoMesa).not.toHaveBeenCalled();
    });

    it('otro comensal de la misma mesa tiene un cobro en curso: la mesa sigue cobrando', async () => {
      tx.pago.count.mockResolvedValue(1);

      expect(await service.vencer(TENANT_ID, 'pago-1')).toBe(true);
      expect(tx.pago.count).toHaveBeenCalledWith({
        where: { estado: 'PENDIENTE', pedido: { mesaId: MESA_ID } },
      });
      expect(tx.mesa.updateMany).not.toHaveBeenCalled();
      expect(pedidos.notificarEstadoMesa).not.toHaveBeenCalled();
    });

    it('la mesa ya no estaba cobrando (por ejemplo, se cerró): vence sin avisar al mapa', async () => {
      tx.mesa.updateMany.mockResolvedValue({ count: 0 });

      expect(await service.vencer(TENANT_ID, 'pago-1')).toBe(true);
      expect(pedidos.notificarEstadoMesa).not.toHaveBeenCalled();
    });
  });
});
