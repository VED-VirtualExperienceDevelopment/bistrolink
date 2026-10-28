import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PagosController } from '../../src/pagos/pagos.controller';
import { MesaQrGuard } from '../../src/qr-mesa/mesa-qr.guard';
import { PedidoAccesoGuard } from '../../src/pedidos/pedido-acceso.guard';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';
const OTRO_PEDIDO_ID = '9f1c7a52-6a1e-4c0b-9d3e-2b8f4a6c1d70';

const BODY = {
  idempotencyKey: 'pago-001',
  medioPago: 'MERCADOPAGO',
  datosPasarela: { token: 'tok', paymentMethodId: 'master' },
};

describe('PagosController (BL-311)', () => {
  let pagosService: { crear: jest.Mock; consultar: jest.Mock };
  let solicitudEfectivo: { solicitar: jest.Mock };
  let controller: PagosController;
  const req = { user: { sub: 'c', tenantId: TENANT_ID, roles: ['COMENSAL'] } };

  beforeEach(() => {
    pagosService = {
      crear: jest.fn().mockResolvedValue({ id: 'pago' }),
      consultar: jest.fn().mockResolvedValue({ pedidoId: PEDIDO_ID }),
    };
    solicitudEfectivo = { solicitar: jest.fn().mockResolvedValue({}) };
    controller = new PagosController(
      pagosService as any,
      solicitudEfectivo as any,
    );
  });

  it('POST pasa por MesaQrGuard y PedidoAccesoGuard, en ese orden (RD.05)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller.crear);
    expect(guards).toEqual([MesaQrGuard, PedidoAccesoGuard]);
  });

  it('cobra el pedido de la RUTA, aunque el body no traiga pedidoId', async () => {
    await controller.crear(req, PEDIDO_ID, { ...BODY } as any);

    expect(pagosService.crear).toHaveBeenCalledWith(TENANT_ID, {
      ...BODY,
      pedidoId: PEDIDO_ID,
    });
  });

  it('si el body trae el mismo pedidoId que la ruta, se acepta', async () => {
    await controller.crear(req, PEDIDO_ID, {
      ...BODY,
      pedidoId: PEDIDO_ID,
    } as any);

    expect(pagosService.crear).toHaveBeenCalled();
  });

  it('si el body trae OTRO pedidoId: 400 y no se cobra (el guard validó el de la ruta)', () => {
    expect(() =>
      controller.crear(req, PEDIDO_ID, {
        ...BODY,
        pedidoId: OTRO_PEDIDO_ID,
      } as any),
    ).toThrow(BadRequestException);
    expect(pagosService.crear).not.toHaveBeenCalled();
  });

  it('GET pasa por los mismos guards que el pago: sin endpoint público de datos fiscales (RD.05)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller.consultar);
    expect(guards).toEqual([MesaQrGuard, PedidoAccesoGuard]);
  });

  it('GET consulta el pedido de la ruta en el tenant del JWT', async () => {
    await controller.consultar(req, PEDIDO_ID);

    expect(pagosService.consultar).toHaveBeenCalledWith(TENANT_ID, PEDIDO_ID);
  });

  describe('solicitud de efectivo (HU-031b, BL-442)', () => {
    it('pasa por los mismos guards que el pago (QR y sesión de la mesa, RD.05)', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        controller.solicitarEfectivo,
      );
      expect(guards).toEqual([MesaQrGuard, PedidoAccesoGuard]);
    });

    it('solicita el efectivo del pedido de la ruta en el tenant del JWT', async () => {
      await controller.solicitarEfectivo(req, PEDIDO_ID, { pagaCon: '1000' });

      expect(solicitudEfectivo.solicitar).toHaveBeenCalledWith(
        TENANT_ID,
        PEDIDO_ID,
        { pagaCon: '1000' },
      );
    });
  });
});
