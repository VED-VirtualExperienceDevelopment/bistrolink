import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { PlexoWebhookService } from './plexo-webhook.service';

interface CallbackPlexo {
  id?: string;
}

@Controller('webhooks')
export class PlexoWebhookController {
  constructor(private readonly webhookService: PlexoWebhookService) {}

  @Post('plexo')
  @HttpCode(200)
  async recibir(@Body() cuerpo: CallbackPlexo | undefined) {
    const paymentId = cuerpo?.id;
    if (!paymentId) {
      Logger.warn(
        'Webhook Plexo: notificación sin id de pago, se ignora',
        PlexoWebhookController.name,
      );
      return { recibido: true };
    }

    await this.webhookService.procesarPago(paymentId);
    return { recibido: true };
  }
}
