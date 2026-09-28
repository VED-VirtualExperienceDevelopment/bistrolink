import { Logger } from '@nestjs/common';
import { BrokenCircuitError, TaskCancelledError } from 'cockatiel';
import { crearPoliticaResiliencia } from '../circuit-breaker.provider';
import {
  PagoGateway,
  ResultadoCobro,
  SolicitudCobro,
} from './pago-gateway.interface';
import { PagoTemporalmenteNoDisponibleException } from './pago-temporalmente-no-disponible.exception';

// Envuelve cualquier gateway con timeout + circuit breaker. No es un
// provider de Nest: la fábrica crea UNA instancia por pasarela.
export class ResilientPagoGateway implements PagoGateway {
  private readonly politica = crearPoliticaResiliencia();

  constructor(private readonly interno: PagoGateway) {}

  async cobrar(solicitud: SolicitudCobro): Promise<ResultadoCobro> {
    try {
      return await this.politica.execute(() => this.interno.cobrar(solicitud));
    } catch (error) {
      if (
        error instanceof TaskCancelledError ||
        error instanceof BrokenCircuitError
      ) {
        Logger.warn(
          `Circuit breaker: pasarela no disponible para el pedido ${solicitud.pedidoId} (${error.constructor.name})`,
          ResilientPagoGateway.name,
        );
        throw new PagoTemporalmenteNoDisponibleException();
      }
      throw error;
    }
  }
}
