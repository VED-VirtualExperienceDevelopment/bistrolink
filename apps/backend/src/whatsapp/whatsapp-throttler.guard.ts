import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Cuántos mensajes por minuto procesa el bot de un mismo teléfono. */
export const LIMITE_MENSAJES_WHATSAPP_POR_MINUTO = 20;

/**
 * HU-010 (BL-112): rate limiting del webhook de WhatsApp.
 *
 * Cuenta por teléfono, no por IP: todos los eventos llegan desde Evolution,
 * con la misma IP. Así un número que manda mensajes sin parar no frena al
 * resto. El cupo se guarda con el hash del chat, nunca con el número. Los
 * eventos sin chat (conexión, QR, estados) comparten un cupo propio.
 *
 * Usa la configuración global de ThrottlerModule (registrada en
 * MesasModule). El límite real está en el @Throttle de la ruta.
 */
@Injectable()
export class WhatsappThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const jid: unknown = req.body?.data?.key?.remoteJid;
    if (typeof jid !== 'string' || jid === '') {
      return Promise.resolve('whatsapp:sin-chat');
    }
    const hash = createHash('sha256').update(jid).digest('hex');
    return Promise.resolve(`whatsapp:${hash}`);
  }
}
