import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { armarReferenciaExterna } from '../../src/pagos/webhooks/referencia-externa';
import {
  estadoPagoDesdeOrden,
  PagosWebhookService,
} from '../../src/pagos/webhooks/pagos-webhook.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const ORDER_ID = 'ORDTST01M3K7AB0GE4WGFXSRXNSH0Y3Y';
const REFERENCIA = armarReferenciaExterna(TENANT_ID, PEDIDO_ID);

// BL-311: lo que devuelve PedidosService.confirmarPagoEnTx al pasar a RECIBIDO.
const PEDIDO_CONFIRMADO = {
  id: PEDIDO_ID,
  estado: 'RECIBIDO',
  createdAt: new Date('2026-10-19T03:00:00.000Z'),
  observacionGeneral: null,
  mesa: { numero: 4 },
  lineas: [],
};

function orden(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    status: 'processed',
    statusDetail: 'accredited',
    totalAmount: '590.00',
    externalReference: REFERENCIA,
    ...overrides,
  };
}

function pagoGuardado(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pago-1',
    pedidoId: PEDIDO_ID,
    medioPago: 'MERCADOPAGO',
    estado: 'PENDIENTE',
    pasarelaReferencia: ORDER_ID,
    monto: new Prisma.Decimal('590'),
    ...overrides,
  };
}

describe('estadoPagoDesdeOrden', () => {
  it.each([
    ['processed', 'accredited', 'APROBADO'],
    ['refunded', 'refunded', 'REEMBOLSADO'],
    ['failed', 'failed', 'RECHAZADO'],
    ['canceled', 'canceled', 'RECHAZADO'],
    ['expired', 'expired', 'RECHAZADO'],
    ['processing', 'in_process', 'PENDIENTE'],
    ['action_required', 'waiting_payment', 'PENDIENTE'],
    ['created', undefined, 'PENDIENTE'],
    ['algo_nuevo', 'algo_nuevo', 'PENDIENTE'],
    [undefined, undefined, 'PENDIENTE'],
    // Procesada pero con otro detalle: no se da por aprobada sin la certeza.
    ['processed', 'partially_refunded', 'PENDIENTE'],
  ])('%s / %s => %s', (status, detalle, esperado) => {
    expect(estadoPagoDesdeOrden(status, detalle)).toBe(esperado);
  });
});

describe('PagosWebhookService.procesarOrden (BL-78)', () => {
  let tx: {
    pago: { findMany: jest.Mock; update: jest.Mock; count: jest.Mock };
    pedido: { findUnique: jest.Mock };
    mesa: { updateMany: jest.Mock };
    pagoEstadoHistorial: { create: jest.Mock; count: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let mercadoPago: { consultarOrden: jest.Mock };
  let cfe: { emitirEnSegundoPlano: jest.Mock };
  let pedidos: {
    confirmarPagoEnTx: jest.Mock;
    notificarPedidoConfirmado: jest.Mock;
    notificarEstadoMesa: jest.Mock;
  };
  let service: PagosWebhookService;

  beforeEach(() => {
    jest.spyOn(Logger, 'warn').mockImplementation();
    jest.spyOn(Logger, 'error').mockImplementation();
    tx = {
      pago: {
        findMany: jest.fn().mockResolvedValue([pagoGuardado()]),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      pedido: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ mesaId: MESA_ID, estado: 'PENDIENTE_PAGO' }),
      },
      mesa: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      pagoEstadoHistorial: {
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_tenantId, callback) => callback(tx)),
    };
    mercadoPago = { consultarOrden: jest.fn().mockResolvedValue(orden()) };
    cfe = { emitirEnSegundoPlano: jest.fn() };
    pedidos = {
      confirmarPagoEnTx: jest.fn().mockResolvedValue(PEDIDO_CONFIRMADO),
      notificarPedidoConfirmado: jest.fn(),
      notificarEstadoMesa: jest.fn(),
    };
    service = new PagosWebhookService(
      tenantPrisma as any,
      mercadoPago as any,
      cfe as any,
      pedidos as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('HU-017 (BL-60): estado de la mesa en el mapa', () => {
    it('el pago resuelto por webhook devuelve la mesa a OCUPADA y lo avisa', async () => {
      await service.procesarOrden(ORDER_ID);

      expect(pedidos.notificarEstadoMesa).toHaveBeenCalledWith(
        TENANT_ID,
        MESA_ID,
        'OCUPADA',
      );
    });

    it('si la mesa ya no estaba cobrando, no avisa', async () => {
      tx.mesa.updateMany.mockResolvedValue({ count: 0 });

      await service.procesarOrden(ORDER_ID);

      expect(pedidos.notificarEstadoMesa).not.toHaveBeenCalled();
    });
  });

  describe('BL-311: prepago (RD.03), confirmación del pedido por webhook', () => {
    it('order procesada => confirma el pedido en la misma transacción y avisa después', async () => {
      await service.procesarOrden(ORDER_ID);

      expect(pedidos.confirmarPagoEnTx).toHaveBeenCalledWith(
        tx,
        TENANT_ID,
        PEDIDO_ID,
      );
      expect(pedidos.notificarPedidoConfirmado).toHaveBeenCalledWith(
        TENANT_ID,
        PEDIDO_CONFIRMADO,
      );
    });

    it('si la respuesta directa ya confirmó el pedido, no avisa dos veces', async () => {
      pedidos.confirmarPagoEnTx.mockResolvedValue(null);

      await service.procesarOrden(ORDER_ID);

      expect(pedidos.notificarPedidoConfirmado).not.toHaveBeenCalled();
    });

    it('order fallida => no confirma el pedido', async () => {
      mercadoPago.consultarOrden.mockResolvedValue(
        orden({ status: 'failed', statusDetail: 'failed' }),
      );

      await service.procesarOrden(ORDER_ID);

      expect(pedidos.confirmarPagoEnTx).not.toHaveBeenCalled();
      expect(pedidos.notificarPedidoConfirmado).not.toHaveBeenCalled();
    });
  });

  describe('resuelve el pago según el estado REAL de la order en Mercado Pago', () => {
    it('order procesada => Pago APROBADO y mesa vuelve a OCUPADA (BL-311)', async () => {
      const resultado = await service.procesarOrden(ORDER_ID);

      expect(resultado).toBe('actualizado');
      expect(tx.pago.update).toHaveBeenCalledWith({
        where: { id: 'pago-1' },
        data: {
          estado: 'APROBADO',
          pasarelaReferencia: ORDER_ID,
          motivoRechazo: null,
        },
      });
      expect(tx.mesa.updateMany).toHaveBeenCalledWith({
        where: { id: MESA_ID, estado: 'EN_PROCESO_DE_PAGO' },
        data: { estado: 'OCUPADA' },
      });
    });

    it('order fallida => Pago RECHAZADO y mesa OCUPADA', async () => {
      mercadoPago.consultarOrden.mockResolvedValue(
        orden({ status: 'failed', statusDetail: 'failed' }),
      );

      const resultado = await service.procesarOrden(ORDER_ID);

      expect(resultado).toBe('actualizado');
      expect(tx.pago.update).toHaveBeenCalledWith({
        where: { id: 'pago-1' },
        data: {
          estado: 'RECHAZADO',
          pasarelaReferencia: ORDER_ID,
          motivoRechazo: 'failed',
        },
      });
      expect(tx.mesa.updateMany).toHaveBeenCalledWith({
        where: { id: MESA_ID, estado: 'EN_PROCESO_DE_PAGO' },
        data: { estado: 'OCUPADA' },
      });
    });

    it.each(['canceled', 'expired'])(
      'order %s => Pago RECHAZADO',
      async (status) => {
        mercadoPago.consultarOrden.mockResolvedValue(
          orden({ status, statusDetail: status }),
        );

        await service.procesarOrden(ORDER_ID);

        expect(tx.pago.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ estado: 'RECHAZADO' }),
          }),
        );
      },
    );

    it('order reembolsada => Pago REEMBOLSADO y la mesa NO se toca', async () => {
      tx.pago.findMany.mockResolvedValue([
        pagoGuardado({ estado: 'APROBADO' }),
      ]);
      mercadoPago.consultarOrden.mockResolvedValue(
        orden({ status: 'refunded', statusDetail: 'refunded' }),
      );

      const resultado = await service.procesarOrden(ORDER_ID);

      expect(resultado).toBe('actualizado');
      expect(tx.pago.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ estado: 'REEMBOLSADO' }),
        }),
      );
      expect(tx.mesa.updateMany).not.toHaveBeenCalled();
    });

    it('order todavía en proceso => no se toca nada (sigue PENDIENTE)', async () => {
      mercadoPago.consultarOrden.mockResolvedValue(
        orden({ status: 'processing', statusDetail: 'in_process' }),
      );

      const resultado = await service.procesarOrden(ORDER_ID);

      expect(resultado).toBe('sin_resolver');
      expect(tenantPrisma.runInTenantContext).not.toHaveBeenCalled();
    });
  });

  describe('aislamiento entre restaurantes (RLS)', () => {
    it('trabaja SIEMPRE dentro del tenant que viene en el external_reference de la order', async () => {
      await service.procesarOrden(ORDER_ID);

      expect(tenantPrisma.runInTenantContext).toHaveBeenCalledTimes(1);
      expect(tenantPrisma.runInTenantContext.mock.calls[0][0]).toBe(TENANT_ID);
    });

    it('busca el pago del pedido que dice la referencia, no uno cualquiera', async () => {
      await service.procesarOrden(ORDER_ID);

      expect(tx.pago.findMany).toHaveBeenCalledWith({
        where: { pedidoId: PEDIDO_ID, medioPago: 'MERCADOPAGO' },
      });
    });

    it('una order que no es de BistroLink (referencia ajena o vieja) se ignora sin tocar la base', async () => {
      mercadoPago.consultarOrden.mockResolvedValue(
        orden({ externalReference: 'ext_ref_1234' }),
      );

      const resultado = await service.procesarOrden(ORDER_ID);

      expect(resultado).toBe('referencia_ajena');
      expect(tenantPrisma.runInTenantContext).not.toHaveBeenCalled();
    });

    it('una order sin external_reference se ignora', async () => {
      mercadoPago.consultarOrden.mockResolvedValue(
        orden({ externalReference: undefined }),
      );

      expect(await service.procesarOrden(ORDER_ID)).toBe('referencia_ajena');
    });
  });

  describe('robustez: notificaciones repetidas, tardías o raras', () => {
    it('idempotente: si el pago ya está en ese estado, no vuelve a escribir', async () => {
      tx.pago.findMany.mockResolvedValue([
        pagoGuardado({ estado: 'APROBADO' }),
      ]);

      const resultado = await service.procesarOrden(ORDER_ID);

      expect(resultado).toBe('sin_cambios');
      expect(tx.pago.update).not.toHaveBeenCalled();
      expect(tx.mesa.updateMany).not.toHaveBeenCalled();
    });

    it('el webhook llegó ANTES de que se guardara la referencia: encuentra el pago PENDIENTE sin referencia y se la completa', async () => {
      tx.pago.findMany.mockResolvedValue([
        pagoGuardado({ pasarelaReferencia: null }),
      ]);

      const resultado = await service.procesarOrden(ORDER_ID);

      expect(resultado).toBe('actualizado');
      expect(tx.pago.update).toHaveBeenCalledWith({
        where: { id: 'pago-1' },
        data: {
          estado: 'APROBADO',
          pasarelaReferencia: ORDER_ID,
          motivoRechazo: null,
        },
      });
    });

    it('con varios intentos del mismo pedido, elige el pago cuya referencia es esa order', async () => {
      tx.pago.findMany.mockResolvedValue([
        pagoGuardado({
          id: 'rechazado-viejo',
          estado: 'RECHAZADO',
          pasarelaReferencia: 'ORD-OTRA',
        }),
        pagoGuardado({ id: 'el-bueno' }),
      ]);

      await service.procesarOrden(ORDER_ID);

      expect(tx.pago.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'el-bueno' } }),
      );
    });

    it('no hay ningún pago que corresponda => se ignora', async () => {
      tx.pago.findMany.mockResolvedValue([]);

      expect(await service.procesarOrden(ORDER_ID)).toBe('pago_no_encontrado');
      expect(tx.pago.update).not.toHaveBeenCalled();
    });

    it('un pago con otra referencia y ya resuelto no se confunde con esta order', async () => {
      tx.pago.findMany.mockResolvedValue([
        pagoGuardado({ estado: 'RECHAZADO', pasarelaReferencia: 'ORD-OTRA' }),
      ]);

      expect(await service.procesarOrden(ORDER_ID)).toBe('pago_no_encontrado');
    });

    it('la order no existe en Mercado Pago (ej. notificación simulada) => se ignora', async () => {
      mercadoPago.consultarOrden.mockResolvedValue(null);

      expect(await service.procesarOrden(ORDER_ID)).toBe('orden_desconocida');
      expect(tenantPrisma.runInTenantContext).not.toHaveBeenCalled();
    });

    it('si la mesa ya no está EN_PROCESO_DE_PAGO no se pisa (la condición va en la propia consulta)', async () => {
      await service.procesarOrden(ORDER_ID);

      expect(tx.mesa.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: MESA_ID, estado: 'EN_PROCESO_DE_PAGO' },
        }),
      );
    });
  });

  describe('HU-032 (BL-202): historial y aprobación tardía', () => {
    const PAGO_VENCIDO = {
      estado: 'RECHAZADO',
      motivoRechazo: 'VENCIDO',
      pasarelaReferencia: null,
    };

    it('cada cambio queda en el historial con su origen (webhook por defecto)', async () => {
      await service.procesarOrden(ORDER_ID);

      expect(tx.pagoEstadoHistorial.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          pagoId: 'pago-1',
          estadoAnterior: 'PENDIENTE',
          estadoNuevo: 'APROBADO',
          origen: 'WEBHOOK',
          detalle: null,
        },
      });
    });

    it('la conciliación usa el mismo flujo y queda registrada como CONCILIACION', async () => {
      mercadoPago.consultarOrden.mockResolvedValue(
        orden({ status: 'failed', statusDetail: 'failed' }),
      );

      expect(await service.procesarOrden(ORDER_ID, 'CONCILIACION')).toBe(
        'actualizado',
      );
      expect(tx.pagoEstadoHistorial.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          origen: 'CONCILIACION',
          estadoNuevo: 'RECHAZADO',
          detalle: 'failed',
        }),
      });
    });

    it('aprobación tardía de un pago VENCIDO sin referencia: si el pedido la puede usar, se aplica', async () => {
      tx.pago.findMany.mockResolvedValue([pagoGuardado(PAGO_VENCIDO)]);

      const resultado = await service.procesarOrden(ORDER_ID);

      expect(resultado).toBe('actualizado');
      expect(tx.pago.update).toHaveBeenCalledWith({
        where: { id: 'pago-1' },
        data: {
          estado: 'APROBADO',
          pasarelaReferencia: ORDER_ID,
          motivoRechazo: null,
        },
      });
      expect(tx.pagoEstadoHistorial.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          estadoAnterior: 'RECHAZADO',
          estadoNuevo: 'APROBADO',
        }),
      });
      expect(pedidos.confirmarPagoEnTx).toHaveBeenCalled();
      expect(cfe.emitirEnSegundoPlano).toHaveBeenCalledWith(
        TENANT_ID,
        'pago-1',
      );
    });

    it('un pago rechazado por la tarjeta (no vencido) y sin referencia no se toma', async () => {
      tx.pago.findMany.mockResolvedValue([
        pagoGuardado({ ...PAGO_VENCIDO, motivoRechazo: 'insufficient_amount' }),
      ]);

      expect(await service.procesarOrden(ORDER_ID)).toBe('pago_no_encontrado');
    });

    it('aprobación tardía con el pedido ya pagado con otro pago: requiere reembolso, no confirma ni emite CFE', async () => {
      tx.pago.findMany.mockResolvedValue([
        pagoGuardado({ ...PAGO_VENCIDO, pasarelaReferencia: ORDER_ID }),
      ]);
      tx.pago.count.mockResolvedValue(1);

      const resultado = await service.procesarOrden(ORDER_ID);

      expect(resultado).toBe('requiere_reembolso');
      expect(tx.pago.count).toHaveBeenCalledWith({
        where: {
          pedidoId: PEDIDO_ID,
          estado: 'APROBADO',
          id: { not: 'pago-1' },
        },
      });
      // El pago refleja lo que pasó (la pasarela cobró)...
      expect(tx.pago.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ estado: 'APROBADO' }),
        }),
      );
      expect(tx.pagoEstadoHistorial.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ detalle: 'REQUIERE_REEMBOLSO' }),
      });
      // ...pero no manda el pedido a cocina otra vez ni factura.
      expect(pedidos.confirmarPagoEnTx).not.toHaveBeenCalled();
      expect(pedidos.notificarPedidoConfirmado).not.toHaveBeenCalled();
      expect(cfe.emitirEnSegundoPlano).not.toHaveBeenCalled();
      expect(Logger.error).toHaveBeenCalled();
    });

    it('aprobación tardía con el pedido cancelado (se cerró la mesa): requiere reembolso', async () => {
      tx.pago.findMany.mockResolvedValue([pagoGuardado(PAGO_VENCIDO)]);
      tx.pedido.findUnique.mockResolvedValue({
        mesaId: MESA_ID,
        estado: 'CANCELADO',
      });

      expect(await service.procesarOrden(ORDER_ID)).toBe('requiere_reembolso');
      expect(pedidos.confirmarPagoEnTx).not.toHaveBeenCalled();
      expect(tx.mesa.updateMany).not.toHaveBeenCalled();
    });

    it('aviso repetido de un pago marcado para reembolso: tampoco emite CFE', async () => {
      tx.pago.findMany.mockResolvedValue([
        pagoGuardado({ estado: 'APROBADO', pasarelaReferencia: ORDER_ID }),
      ]);
      tx.pagoEstadoHistorial.count.mockResolvedValue(1);

      expect(await service.procesarOrden(ORDER_ID)).toBe('requiere_reembolso');
      expect(tx.pagoEstadoHistorial.count).toHaveBeenCalledWith({
        where: { pagoId: 'pago-1', detalle: 'REQUIERE_REEMBOLSO' },
      });
      expect(cfe.emitirEnSegundoPlano).not.toHaveBeenCalled();
    });

    it('order fallida sobre un pago ya vencido: mismo estado, solo completa la referencia', async () => {
      tx.pago.findMany.mockResolvedValue([pagoGuardado(PAGO_VENCIDO)]);
      mercadoPago.consultarOrden.mockResolvedValue(
        orden({ status: 'expired', statusDetail: 'expired' }),
      );

      expect(await service.procesarOrden(ORDER_ID)).toBe('sin_cambios');
      expect(tx.pago.update).toHaveBeenCalledWith({
        where: { id: 'pago-1' },
        data: { pasarelaReferencia: ORDER_ID },
      });
      expect(tx.pagoEstadoHistorial.create).not.toHaveBeenCalled();
    });
  });

  describe('defensa: el monto tiene que coincidir', () => {
    it('la order dice otro monto que el pago => NO se aprueba y queda logueado', async () => {
      mercadoPago.consultarOrden.mockResolvedValue(
        orden({ totalAmount: '1.00' }),
      );

      const resultado = await service.procesarOrden(ORDER_ID);

      expect(resultado).toBe('monto_no_coincide');
      expect(tx.pago.update).not.toHaveBeenCalled();
      expect(tx.mesa.updateMany).not.toHaveBeenCalled();
      expect(Logger.error).toHaveBeenCalled();
    });

    it('la order no informa monto => tampoco se aprueba', async () => {
      mercadoPago.consultarOrden.mockResolvedValue(
        orden({ totalAmount: undefined }),
      );

      expect(await service.procesarOrden(ORDER_ID)).toBe('monto_no_coincide');
    });

    it('590 y 590.00 son el mismo monto', async () => {
      mercadoPago.consultarOrden.mockResolvedValue(
        orden({ totalAmount: '590' }),
      );

      expect(await service.procesarOrden(ORDER_ID)).toBe('actualizado');
    });
  });

  describe('errores: tienen que subir para que Mercado Pago reintente', () => {
    it('Mercado Pago no responde al consultar la order => el error se propaga', async () => {
      mercadoPago.consultarOrden.mockRejectedValue(
        new Error('502 de Mercado Pago'),
      );

      await expect(service.procesarOrden(ORDER_ID)).rejects.toThrow(
        '502 de Mercado Pago',
      );
    });

    it('falla la base => el error se propaga', async () => {
      tenantPrisma.runInTenantContext.mockRejectedValue(
        new Error('base caída'),
      );

      await expect(service.procesarOrden(ORDER_ID)).rejects.toThrow(
        'base caída',
      );
    });
  });

  describe('emisión del CFE', () => {
    it('order procesada => emite el comprobante del pago', async () => {
      await service.procesarOrden(ORDER_ID);

      expect(cfe.emitirEnSegundoPlano).toHaveBeenCalledWith(
        TENANT_ID,
        'pago-1',
      );
    });

    it('notificación repetida (sin_cambios) => reintenta la emisión, por si falló antes', async () => {
      tx.pago.findMany.mockResolvedValue([
        pagoGuardado({ estado: 'APROBADO', pasarelaReferencia: ORDER_ID }),
      ]);

      const resultado = await service.procesarOrden(ORDER_ID);

      expect(resultado).toBe('sin_cambios');
      expect(cfe.emitirEnSegundoPlano).toHaveBeenCalledWith(
        TENANT_ID,
        'pago-1',
      );
    });

    it('order fallida => no emite nada', async () => {
      mercadoPago.consultarOrden.mockResolvedValue(
        orden({ status: 'failed', statusDetail: 'failed' }),
      );

      await service.procesarOrden(ORDER_ID);

      expect(cfe.emitirEnSegundoPlano).not.toHaveBeenCalled();
    });
  });
});
