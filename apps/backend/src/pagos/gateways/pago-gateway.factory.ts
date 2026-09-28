import { BadRequestException, Injectable } from '@nestjs/common';
import { PagoGateway } from './pago-gateway.interface';
import { MercadoPagoGateway } from './mercadopago.gateway';
import { FakePagoGateway } from './fake.gateway';
import { ResilientPagoGateway } from './resilient-pago-gateway.decorator';

@Injectable()
export class PagoGatewayFactory {
  private readonly mercadoPago: PagoGateway;
  private readonly plexo: PagoGateway;

  constructor(
    mercadoPagoGateway: MercadoPagoGateway,
    fakeGateway: FakePagoGateway,
  ) {
    // Una sola instancia resiliente por pasarela: el estado del circuit
    // breaker (cuántos fallos seguidos hubo) tiene que compartirse entre
    // requests, si no el circuito nunca se abre.
    this.mercadoPago = new ResilientPagoGateway(mercadoPagoGateway);
    // TODO: reemplazar por PlexoGateway real cuando lleguen las credenciales.
    this.plexo = new ResilientPagoGateway(fakeGateway);
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
