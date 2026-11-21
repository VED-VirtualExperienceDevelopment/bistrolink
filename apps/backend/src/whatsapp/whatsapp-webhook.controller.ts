import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  HEADER_SECRETO_WEBHOOK,
  secretoWebhookValido,
} from './configuracion-whatsapp';
import { leerMensajeEntrante } from './mensaje-evolution';
import {
  LIMITE_MENSAJES_WHATSAPP_POR_MINUTO,
  WhatsappThrottlerGuard,
} from './whatsapp-throttler.guard';
import { WhatsappService } from './whatsapp.service';

/**
 * HU-010 (BL-112): webhook que llama Evolution API con cada evento.
 *
 * Endpoint PÚBLICO (Evolution no manda JWT): la autenticidad se comprueba
 * con el secreto compartido del header `x-bistrolink-webhook-secreto`,
 * comparado en tiempo constante. Sin el secreto configurado (bot apagado)
 * se rechaza todo con 401.
 *
 * Con un secreto válido responde siempre 200, aunque el evento no sea un
 * mensaje o falle algo: si respondiera un error, Evolution reintentaría el
 * mismo evento. Los mensajes repetidos los descarta WhatsappService.
 */
@ApiTags('Webhooks')
@Controller('webhooks')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(private readonly whatsapp: WhatsappService) {}

  @Post('whatsapp')
  @HttpCode(200)
  @UseGuards(WhatsappThrottlerGuard)
  @Throttle({
    default: { limit: LIMITE_MENSAJES_WHATSAPP_POR_MINUTO, ttl: 60_000 },
  })
  async recibir(
    @Headers(HEADER_SECRETO_WEBHOOK) secreto: string | undefined,
    @Body() cuerpo: unknown,
  ): Promise<{ ok: true }> {
    const config = this.whatsapp.configuracion();
    if (!config || !secretoWebhookValido(secreto, config.secretoWebhook)) {
      if (!config) {
        this.logger.warn(
          'Evento de WhatsApp rechazado: el bot no está configurado (faltan variables de Evolution)',
        );
      }
      throw new UnauthorizedException('Secreto inválido');
    }

    const mensaje = leerMensajeEntrante(cuerpo);
    if (!mensaje) return { ok: true };

    try {
      await this.whatsapp.procesar(mensaje);
    } catch (error) {
      // Sin el texto ni el número: solo el motivo.
      this.logger.error(
        `Falló el procesamiento de un mensaje de WhatsApp: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { ok: true };
  }
}
