import { Prisma } from '@prisma/client';
import { FakePagoGateway } from '../../src/pagos/gateways/fake.gateway';

describe('FakePagoGateway', () => {
  it('aprueba con una referencia derivada de la clave de idempotencia', async () => {
    const resultado = await new FakePagoGateway().cobrar({
      monto: new Prisma.Decimal('590'),
      idempotencyKey: 'pago-001',
      pedidoId: 'p',
      tenantId: 't',
      datosPasarela: {},
    });

    expect(resultado).toEqual({
      aprobado: true,
      pasarelaReferencia: 'FAKE-pago-001',
    });
  });
});
