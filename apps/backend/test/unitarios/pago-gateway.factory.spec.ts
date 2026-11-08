import { BadRequestException } from '@nestjs/common';
import { MercadoPagoGateway } from '../../src/pagos/gateways/mercadopago.gateway';
import { PlexoGateway } from '../../src/pagos/gateways/plexo.gateway';
import { PagoGatewayFactory } from '../../src/pagos/gateways/pago-gateway.factory';

describe('PagoGatewayFactory', () => {
  let fabrica: PagoGatewayFactory;
  const mercadoPago = { cobrar: jest.fn() } as unknown as MercadoPagoGateway;
  const plexo = { cobrar: jest.fn() } as unknown as PlexoGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    fabrica = new PagoGatewayFactory(mercadoPago, plexo);
  });

  it('devuelve la MISMA instancia en cada request: el circuit breaker comparte estado', () => {
    expect(fabrica.obtener('MERCADOPAGO')).toBe(fabrica.obtener('MERCADOPAGO'));
    expect(fabrica.obtener('PLEXO')).toBe(fabrica.obtener('PLEXO'));
  });

  it('cada pasarela tiene su propio circuito', () => {
    expect(fabrica.obtener('MERCADOPAGO')).not.toBe(fabrica.obtener('PLEXO'));
  });

  it('delega el cobro en Mercado Pago', async () => {
    (mercadoPago.cobrar as jest.Mock).mockResolvedValue({
      aprobado: true,
      pasarelaReferencia: 'ORD1',
    });

    await fabrica.obtener('MERCADOPAGO').cobrar({} as any);

    expect(mercadoPago.cobrar).toHaveBeenCalled();
    expect(plexo.cobrar).not.toHaveBeenCalled();
  });

  it('delega el cobro en Plexo', async () => {
    (plexo.cobrar as jest.Mock).mockResolvedValue({
      aprobado: false,
      pendiente: true,
      pasarelaReferencia: 'ses-1',
      accionRequerida: {
        tipo: 'iframe',
        url: 'https://checkout.testing.plexo.com.uy/e/ses-1',
      },
    });

    await fabrica.obtener('PLEXO').cobrar({} as any);

    expect(plexo.cobrar).toHaveBeenCalled();
    expect(mercadoPago.cobrar).not.toHaveBeenCalled();
  });

  it('un medio de pago desconocido => 400', () => {
    expect(() => fabrica.obtener('BITCOIN')).toThrow(BadRequestException);
  });
});
