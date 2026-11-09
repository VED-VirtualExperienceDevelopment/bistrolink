import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PagosWebhookService } from '../../src/pagos/webhooks/pagos-webhook.service';
import { PlexoWebhookService } from '../../src/pagos/webhooks/plexo-webhook.service';
import { armarReferenciaExterna } from '../../src/pagos/webhooks/referencia-externa';

// HU-022 (BL-494, BL-85): los webhooks comparan la order contra lo que se
// cobró, que es el consumo más la propina.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const ORDER_ID = 'ORDTST01M3K7AB0GE4WGFXSRXNSH0Y3Y';
const PAYMENT_ID = '1f1d6eb0431b48a2b5a36895e8f77cb0';
const REFERENCIA = armarReferenciaExterna(TENANT_ID, PEDIDO_ID);

const PEDIDO_CONFIRMADO = {
  id: PEDIDO_ID,
  estado: 'RECIBIDO',
  createdAt: new Date('2026-11-09T12:00:00.000Z'),
  observacionGeneral: null,
  mesa: { numero: 4 },
  lineas: [],
};

function crearTx(pagoBd: Record<string, unknown>) {
  return {
    pago: {
      findMany: jest.fn().mockResolvedValue([pagoBd]),
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
}

function pedidos() {
  return {
    confirmarPagoEnTx: jest.fn().mockResolvedValue(PEDIDO_CONFIRMADO),
    notificarPedidoConfirmado: jest.fn(),
    notificarEstadoMesa: jest.fn(),
  };
}

describe('webhooks con propina (HU-022, BL-494)', () => {
  beforeEach(() => {
    jest.spyOn(Logger, 'warn').mockImplementation();
    jest.spyOn(Logger, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('Mercado Pago', () => {
    function armar(pagoBd: Record<string, unknown>, totalAmount: string) {
      const tx = crearTx({
        id: 'pago-1',
        pedidoId: PEDIDO_ID,
        medioPago: 'MERCADOPAGO',
        estado: 'PENDIENTE',
        pasarelaReferencia: ORDER_ID,
        motivoRechazo: null,
        monto: new Prisma.Decimal('590'),
        ...pagoBd,
      });
      const mercadoPago = {
        consultarOrden: jest.fn().mockResolvedValue({
          id: ORDER_ID,
          status: 'processed',
          statusDetail: 'accredited',
          totalAmount,
          externalReference: REFERENCIA,
        }),
      };
      const service = new PagosWebhookService(
        { runInTenantContext: jest.fn((_t, cb) => cb(tx)) } as any,
        mercadoPago as any,
        { emitirEnSegundoPlano: jest.fn() } as any,
        pedidos() as any,
      );
      return { tx, service };
    }

    it('con propina: la order por consumo + propina coincide y el pago se aprueba', async () => {
      const { tx, service } = armar(
        { propina: new Prisma.Decimal('88') },
        '678.00',
      );

      await expect(service.procesarOrden(ORDER_ID)).resolves.toBe(
        'actualizado',
      );
      expect(tx.pago.update).toHaveBeenCalled();
    });

    it('con propina: una order solo por el consumo no coincide y no se resuelve el pago', async () => {
      const { tx, service } = armar(
        { propina: new Prisma.Decimal('88') },
        '590.00',
      );

      await expect(service.procesarOrden(ORDER_ID)).resolves.toBe(
        'monto_no_coincide',
      );
      expect(tx.pago.update).not.toHaveBeenCalled();
    });

    it('sin propina (propina 0): sigue comparando contra el monto', async () => {
      const { service } = armar({ propina: new Prisma.Decimal('0') }, '590.00');

      await expect(service.procesarOrden(ORDER_ID)).resolves.toBe(
        'actualizado',
      );
    });
  });

  describe('Plexo', () => {
    function armar(pagoBd: Record<string, unknown>, totalAmount: number) {
      const tx = crearTx({
        id: 'pago-1',
        pedidoId: PEDIDO_ID,
        medioPago: 'PLEXO',
        estado: 'PENDIENTE',
        pasarelaReferencia: PAYMENT_ID,
        monto: new Prisma.Decimal('590'),
        ...pagoBd,
      });
      const plexo = {
        consultarPago: jest.fn().mockResolvedValue({
          id: PAYMENT_ID,
          status: 'approved',
          totalAmount,
          referenceId: REFERENCIA,
        }),
      };
      const service = new PlexoWebhookService(
        { runInTenantContext: jest.fn((_t, cb) => cb(tx)) } as any,
        plexo as any,
        { emitirEnSegundoPlano: jest.fn() } as any,
        pedidos() as any,
      );
      return { tx, service };
    }

    it('con propina: el pago por consumo + propina coincide y se aprueba', async () => {
      const { tx, service } = armar({ propina: new Prisma.Decimal('88') }, 678);

      await expect(service.procesarPago(PAYMENT_ID)).resolves.toBe(
        'actualizado',
      );
      expect(tx.pago.update).toHaveBeenCalled();
    });

    it('con propina: un pago solo por el consumo no coincide y no se resuelve', async () => {
      const { tx, service } = armar({ propina: new Prisma.Decimal('88') }, 590);

      await expect(service.procesarPago(PAYMENT_ID)).resolves.toBe(
        'monto_no_coincide',
      );
      expect(tx.pago.update).not.toHaveBeenCalled();
    });

    it('sin propina (propina 0): sigue comparando contra el monto', async () => {
      const { service } = armar({ propina: new Prisma.Decimal('0') }, 590);

      await expect(service.procesarPago(PAYMENT_ID)).resolves.toBe(
        'actualizado',
      );
    });
  });
});
