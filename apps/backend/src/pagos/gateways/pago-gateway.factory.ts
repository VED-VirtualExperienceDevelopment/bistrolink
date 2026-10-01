import { BadRequestException, Injectable } from '@nestjs/common';
import { PagoGateway } from './pago-gateway.interface';
import { MercadoPagoGateway } from './mercadopago.gateway';
import { PlexoGateway } from './plexo.gateway';
import { ResilientPagoGateway } from './resilient-pago-gateway.decorator';

@Injectable()
export class PagoGatewayFactory {
  private readonly mercadoPago: PagoGateway;
  private readonly plexo: PagoGateway;

  constructor(
    mercadoPagoGateway: MercadoPagoGateway,
    plexoGateway: PlexoGateway,
  ) {
    this.mercadoPago = new ResilientPagoGateway(mercadoPagoGateway);
    this.plexo = new ResilientPagoGateway(plexoGateway);
  }

  obtener(medioPago: string): PagoGateway {
    switch (medioPago) {
      case 'MERCADOPAGO':
        return this.mercadoPago;
      case 'PLEXO':
        return this.plexo;
      default:
        throw new BadRequestException(
          `Medio de pago no soportado: ${medioPago}`,
        );
    }
  }
}
