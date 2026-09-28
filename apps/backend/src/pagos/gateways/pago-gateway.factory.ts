import { BadRequestException, Injectable } from '@nestjs/common';
import { PagoGateway } from './pago-gateway.interface';
import { MercadoPagoGateway } from './mercadopago.gateway';
import { FakePagoGateway } from './fake.gateway';

@Injectable()
export class PagoGatewayFactory {
  constructor(
    private readonly mercadoPagoGateway: MercadoPagoGateway,
    // TODO: reemplazar por PlexoGateway real en cuanto lleguen las
    // credenciales (.pfx + ClientName/Password) que pedimos por mail.
    private readonly fakeGateway: FakePagoGateway,
  ) {}

  obtener(medioPago: string): PagoGateway {
    switch (medioPago) {
      case 'MERCADOPAGO':
        return this.mercadoPagoGateway;
      case 'PLEXO':
        return this.fakeGateway;
      default:
        throw new BadRequestException(
          `Medio de pago no soportado: ${medioPago}`,
        );
    }
  }
}
