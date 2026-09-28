import { BadRequestException } from '@nestjs/common';
import { FakePagoGateway } from '../../src/pagos/gateways/fake.gateway';
import { MercadoPagoGateway } from '../../src/pagos/gateways/mercadopago.gateway';
import { PagoGatewayFactory } from '../../src/pagos/gateways/pago-gateway.factory';

describe('PagoGatewayFactory', () => {
  let fabrica: PagoGatewayFactory;
  const mercadoPago = { cobrar: jest.fn() } as unknown as MercadoPagoGateway;
  const fake = { cobrar: jest.fn() } as unknown as FakePagoGateway;

  beforeEach(() => {
    fabrica = new PagoGatewayFactory(mercadoPago, fake);
  });

  it('devuelve la MISMA instancia en cada request: el circuit breaker comparte estado', () => {
    expect(fabrica.obtener('MERCADOPAGO')).toBe(fabrica.obtener('MERCADOPAGO'));
    expect(fabrica.obtener('PLEXO')).toBe(fabrica.obtener('PLEXO'));
  });

  it('cada pasarela tiene su propio circuito', () => {
    expect(fabrica.obtener('MERCADOPAGO')).not.toBe(fabrica.obtener('PLEXO'));
  });

  it('delega el cobro en el gateway correspondiente', async () => {
    (mercadoPago.cobrar as jest.Mock).mockResolvedValue({
      aprobado: true,
      pasarelaReferencia: 'ORD1',
    });

    await fabrica.obtener('MERCADOPAGO').cobrar({} as any);

    expect(mercadoPago.cobrar).toHaveBeenCalled();
    expect(fake.cobrar).not.toHaveBeenCalled();
  });

  it('un medio de pago desconocido => 400', () => {
    expect(() => fabrica.obtener('BITCOIN')).toThrow(BadRequestException);
  });
});
