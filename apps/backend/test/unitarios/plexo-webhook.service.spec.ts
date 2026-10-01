import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { armarReferenciaExterna } from '../../src/pagos/webhooks/referencia-externa';
import {
  estadoPagoDesdePlexo,
  PlexoWebhookService,
} from '../../src/pagos/webhooks/plexo-webhook.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const PAYMENT_ID = '1f1d6eb0431b48a2b5a36895e8f77cb0';
const REFERENCIA = armarReferenciaExterna(TENANT_ID, PEDIDO_ID);

function pago(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    status: 'approved',
    totalAmount: 590,
    referenceId: REFERENCIA,
    ...overrides,
  };
}

function pagoGuardado(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pago-1',
    pedidoId: PEDIDO_ID,
    medioPago: 'PLEXO',
    estado: 'PENDIENTE',
    pasarelaReferencia: PAYMENT_ID,
    monto: new Prisma.Decimal('590'),
    ...overrides,
  };
}

describe('estadoPagoDesdePlexo', () => {
  it.each([
    ['approved', 'APROBADO'],
    ['denied', 'RECHAZADO'],
    ['pending', 'PENDIENTE'],
    ['authorized', 'PENDIENTE'], // reservado pero no capturado: no es final
    ['algo_desconocido', 'PENDIENTE'],
    [undefined, 'PENDIENTE'],
  ])('%s => %s', (status, esperado) => {
    expect(estadoPagoDesdePlexo(status)).toBe(esperado);
  });
});

describe('PlexoWebhookService.procesarPago (BL-78)', () => {
  let tx: {
    pago: { findMany: jest.Mock; update: jest.Mock };
    pedido: { findUnique: jest.Mock };
    mesa: { updateMany: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let plexo: { consultarPago: jest.Mock };
  let service: PlexoWebhookService;

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
    plexo = { consultarPago: jest.fn().mockResolvedValue(pago()) };
    service = new PlexoWebhookService(tenantPrisma as any, plexo as any);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('resuelve el pago según el estado REAL en Plexo', () => {
    it('approved => Pago APROBADO y mesa LIBRE', async () => {
      const resultado = await service.procesarPago(PAYMENT_ID);

      expect(resultado).toBe('actualizado');
      expect(tx.pago.update).toHaveBeenCalledWith({
        where: { id: 'pago-1' },
        data: { estado: 'APROBADO', pasarelaReferencia: PAYMENT_ID },
      });
      expect(tx.mesa.updateMany).toHaveBeenCalledWith({
        where: { id: MESA_ID, estado: 'EN_PROCESO_DE_PAGO' },
        data: { estado: 'LIBRE' },
      });
    });

    it('denied => Pago RECHAZADO y mesa OCUPADA', async () => {
      plexo.consultarPago.mockResolvedValue(pago({ status: 'denied' }));

      const resultado = await service.procesarPago(PAYMENT_ID);

      expect(resultado).toBe('actualizado');
      expect(tx.pago.update).toHaveBeenCalledWith({
        where: { id: 'pago-1' },
        data: { estado: 'RECHAZADO', pasarelaReferencia: PAYMENT_ID },
      });
      expect(tx.mesa.updateMany).toHaveBeenCalledWith({
        where: { id: MESA_ID, estado: 'EN_PROCESO_DE_PAGO' },
        data: { estado: 'OCUPADA' },
      });
    });

    it.each(['pending', 'authorized'])(
      'status %s: todavía no es final, no se toca nada',
      async (status) => {
        plexo.consultarPago.mockResolvedValue(pago({ status }));

        const resultado = await service.procesarPago(PAYMENT_ID);

        expect(resultado).toBe('sin_resolver');
        expect(tenantPrisma.runInTenantContext).not.toHaveBeenCalled();
      },
    );
  });

  describe('aislamiento entre restaurantes (RLS)', () => {
    it('trabaja SIEMPRE dentro del tenant que viene en el referenceId del pago', async () => {
      await service.procesarPago(PAYMENT_ID);

      expect(tenantPrisma.runInTenantContext).toHaveBeenCalledTimes(1);
      expect(tenantPrisma.runInTenantContext.mock.calls[0][0]).toBe(TENANT_ID);
    });

    it('busca el pago del pedido que dice la referencia, filtrando por PLEXO', async () => {
      await service.procesarPago(PAYMENT_ID);

      expect(tx.pago.findMany).toHaveBeenCalledWith({
        where: { pedidoId: PEDIDO_ID, medioPago: 'PLEXO' },
      });
    });

    it('un pago sin referencia de BistroLink se ignora sin tocar la base', async () => {
      plexo.consultarPago.mockResolvedValue(pago({ referenceId: 'otra-cosa' }));

      const resultado = await service.procesarPago(PAYMENT_ID);

      expect(resultado).toBe('referencia_ajena');
      expect(tenantPrisma.runInTenantContext).not.toHaveBeenCalled();
    });
  });

  describe('robustez: notificaciones repetidas, tardías o raras', () => {
    it('idempotente: si ya está en ese estado, no vuelve a escribir', async () => {
      tx.pago.findMany.mockResolvedValue([
        pagoGuardado({ estado: 'APROBADO' }),
      ]);

      const resultado = await service.procesarPago(PAYMENT_ID);

      expect(resultado).toBe('sin_cambios');
      expect(tx.pago.update).not.toHaveBeenCalled();
      expect(tx.mesa.updateMany).not.toHaveBeenCalled();
    });

    it('el pago no existe en Plexo (notificación simulada/errónea) => se ignora', async () => {
      plexo.consultarPago.mockResolvedValue(null);

      expect(await service.procesarPago(PAYMENT_ID)).toBe('pago_desconocido');
      expect(tenantPrisma.runInTenantContext).not.toHaveBeenCalled();
    });

    it('no hay ningún Pago de Plexo que corresponda a ese pedido => se ignora', async () => {
      tx.pago.findMany.mockResolvedValue([]);

      expect(await service.procesarPago(PAYMENT_ID)).toBe('pago_no_encontrado');
      expect(tx.pago.update).not.toHaveBeenCalled();
    });

    it('un pago de Mercado Pago del mismo pedido no se confunde con el de Plexo (filtra por medioPago)', async () => {
      // El mock de findMany ya está limitado a medioPago: 'PLEXO' en la
      // llamada; acá confirmamos que si no hay NINGUNO con ese filtro, se
      // ignora en vez de usar un pago de otra pasarela.
      tx.pago.findMany.mockResolvedValue([]);

      expect(await service.procesarPago(PAYMENT_ID)).toBe('pago_no_encontrado');
    });
  });

  describe('defensa: el monto tiene que coincidir', () => {
    it('otro monto => no se aprueba, queda logueado', async () => {
      plexo.consultarPago.mockResolvedValue(pago({ totalAmount: 1 }));

      const resultado = await service.procesarPago(PAYMENT_ID);

      expect(resultado).toBe('monto_no_coincide');
      expect(tx.pago.update).not.toHaveBeenCalled();
      expect(Logger.error).toHaveBeenCalled();
    });

    it('sin monto informado => tampoco se aprueba', async () => {
      plexo.consultarPago.mockResolvedValue(pago({ totalAmount: undefined }));

      expect(await service.procesarPago(PAYMENT_ID)).toBe('monto_no_coincide');
    });
  });

  describe('errores: suben para que Plexo reintente', () => {
    it('Plexo no responde al consultar => el error se propaga', async () => {
      plexo.consultarPago.mockRejectedValue(new Error('502 de Plexo'));

      await expect(service.procesarPago(PAYMENT_ID)).rejects.toThrow(
        '502 de Plexo',
      );
    });

    it('falla la base => el error se propaga', async () => {
      tenantPrisma.runInTenantContext.mockRejectedValue(
        new Error('base caída'),
      );

      await expect(service.procesarPago(PAYMENT_ID)).rejects.toThrow(
        'base caída',
      );
    });
  });
});
