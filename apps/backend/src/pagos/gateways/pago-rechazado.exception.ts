import { HttpException, HttpStatus } from '@nestjs/common';

const MENSAJES: Record<string, string> = {
  insufficient_amount:
    'Tu tarjeta no tiene fondos suficientes. No se realizó ningún cargo.',
  rejected_by_issuer:
    'Tu banco rechazó el pago. No se realizó ningún cargo: probá con otra tarjeta o consultá con tu banco.',
};

// BL-77: un rechazo de la tarjeta no es un error técnico, es un resultado
// esperable. El Pago ya quedó guardado como RECHAZADO cuando se lanza.
export class PagoRechazadoException extends HttpException {
  constructor(motivo?: string) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Payment Required',
        message:
          (motivo && MENSAJES[motivo]) ??
          'El pago fue rechazado. No se realizó ningún cargo: probá con otra tarjeta.',
        motivo,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
