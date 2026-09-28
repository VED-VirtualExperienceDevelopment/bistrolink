import { ServiceUnavailableException } from '@nestjs/common';

export class PagoTemporalmenteNoDisponibleException extends ServiceUnavailableException {
  constructor() {
    super(
      'La pasarela de pago no responde en este momento. Tu pago quedó pendiente: probá de nuevo en unos minutos.',
    );
  }
}
