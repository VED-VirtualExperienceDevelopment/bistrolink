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
    pago: { findMany: jest.Mock; update: jest.Mock };
    pedido: { findUnique: jest.Mock };
    mesa: { updateMany: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let mercadoPago: { consultarOrden: jest.Mock };
  let service: PagosWebhookService;

  beforeEach(() => {
    jest.spyOn(Logger, 'warn').mockImplementation();
    jest.spyOn(Logger, 'error').mockImplementation();
    tx = {
      pago: {
        findMany: jest.fn().mockResolvedValue([pagoGuardado()]),
        update: jest.fn(),
      },
      pedido: { findUnique: jest.fn().mockResolvedValue({ mesaId: MESA_ID }) },
      mesa: { updateMany: jest.fn() },
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_tenantId, callback) => callback(tx)),
    };
    mercadoPago = { consultarOrden: jest.fn().mockResolvedValue(orden()) };
    service = new PagosWebhookService(tenantPrisma as any, mercadoPago as any);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('resuelve el pago según el estado REAL de la order en Mercado Pago', () => {
    it('order procesada => Pago APROBADO y mesa LIBRE', async () => {
      const resultado = await service.procesarOrden(ORDER_ID);

      expect(resultado).toBe('actualizado');
      expect(tx.pago.update).toHaveBeenCalledWith({
        where: { id: 'pago-1' },
        data: { estado: 'APROBADO', pasarelaReferencia: ORDER_ID },
      });
      expect(tx.mesa.updateMany).toHaveBeenCalledWith({
        where: { id: MESA_ID, estado: 'EN_PROCESO_DE_PAGO' },
        data: { estado: 'LIBRE' },
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
        data: { estado: 'RECHAZADO', pasarelaReferencia: ORDER_ID },
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
        data: { estado: 'APROBADO', pasarelaReferencia: ORDER_ID },
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
});
