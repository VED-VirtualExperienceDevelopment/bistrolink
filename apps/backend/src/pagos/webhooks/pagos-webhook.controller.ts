import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import {
  diagnosticoFirmaWebhook,
  firmaWebhookMercadoPagoValida,
} from './firma-webhook-mercadopago';
import {
  CuerpoNotificacion,
  leerNotificacionOrden,
} from './notificacion-mercadopago';
import { PagosWebhookService } from './pagos-webhook.service';
import { ApiTags } from '@nestjs/swagger';

// Endpoint PÚBLICO (Mercado Pago no manda JWT): la autenticidad de cada
// notificación se comprueba con la firma HMAC-SHA256 (BL-78).
@ApiTags('Webhooks')
@Controller('webhooks')
export class PagosWebhookController {
  constructor(private readonly webhookService: PagosWebhookService) {}

  @Post('mercadopago')
  @HttpCode(200)
  async recibir(
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
    @Query('data.id') dataId: string | undefined,
    @Query('type') tipoQuery: string | undefined,
    @Body() cuerpo: CuerpoNotificacion | undefined,
  ) {
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!secret) {
      Logger.error(
        'MP_WEBHOOK_SECRET no está configurado: se rechazan todas las notificaciones',
        undefined,
        PagosWebhookController.name,
      );
    }

    if (
      !firmaWebhookMercadoPagoValida({ xSignature, xRequestId, dataId, secret })
    ) {
      Logger.warn(
        `Notificación de Mercado Pago rechazada (firma inválida): ${diagnosticoFirmaWebhook({ xSignature, xRequestId, dataId, secret })}`,
        PagosWebhookController.name,
      );
      throw new UnauthorizedException('Firma inválida');
    }

    const orderId = leerNotificacionOrden(
      { type: tipoQuery, 'data.id': dataId },
      cuerpo,
    );
    if (!orderId) {
      return { recibido: true }; // otro tipo de evento: se confirma y se ignora
    }

    // Un error acá (Mercado Pago caído, base caída) sube como 5xx a
    // propósito: Mercado Pago reintenta hasta recibir un 200.
    await this.webhookService.procesarOrden(orderId);
    return { recibido: true };
  }
}
