import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Cuántas veces por minuto se piden complementos desde un mismo QR. */
export const LIMITE_COMPLEMENTOS_POR_QR = 20;
/** Cuántas veces por minuto se piden desde el enlace web de un local. */
export const LIMITE_COMPLEMENTOS_POR_LOCAL = 120;

/**
 * HU-046 (BL-552): rate limiting del endpoint público de complementos.
 *
 * No cuenta por IP: detrás del proxy de Railway todos los comensales llegan
 * con la misma, y los de un local comparten el Wi-Fi. Por QR, cuenta por
 * mesa (el hash del token, nunca el token); por enlace web, por local. El
 * cupo del enlace es más grande porque lo comparten todos los que piden
 * para retirar. Si se pasa, la carta no muestra la sugerencia: es una ayuda,
 * no algo para pedir.
 *
 * Usa la configuración global de ThrottlerModule (registrada en
 * MesasModule). El límite real de cada ruta está en su @Throttle.
 */
@Injectable()
export class ComplementosThrottlerGuard extends ThrottlerGuard {
  // La firma de ThrottlerGuard exige una promesa; acá no hay nada que esperar.
  protected getTracker(req: Record<string, any>): Promise<string> {
    const token: unknown = req.params?.token;
    if (typeof token === 'string' && token !== '') {
      const hash = createHash('sha256').update(token).digest('hex');
      return Promise.resolve(`complementos:qr:${hash}`);
    }
    return Promise.resolve(
      `complementos:local:${String(req.params?.restauranteId ?? '')}`,
    );
  }
}
