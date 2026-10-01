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
import { firmaWebhookMercadoPagoValida } from './firma-webhook-mercadopago';
import { PagosWebhookService } from './pagos-webhook.service';

interface CuerpoNotificacion {
  type?: string;
  data?: { id?: string };
}

// Endpoint PÚBLICO (Mercado Pago no manda JWT): la autenticidad de cada
// notificación se comprueba con la firma HMAC-SHA256 (BL-78).
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
      throw new UnauthorizedException('Firma inválida');
    }

    const tipo = tipoQuery ?? cuerpo?.type;
    const orderId = dataId ?? cuerpo?.data?.id;
    if (tipo !== 'order' || !orderId) {
      return { recibido: true }; // otro tipo de evento: se confirma y se ignora
    }

    // Un error acá (Mercado Pago caído, base caída) sube como 5xx a
    // propósito: Mercado Pago reintenta hasta recibir un 200.
    await this.webhookService.procesarOrden(orderId);
    return { recibido: true };
  }
}
