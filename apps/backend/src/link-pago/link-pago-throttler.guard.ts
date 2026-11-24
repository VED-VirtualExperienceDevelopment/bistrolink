import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Cuántas veces por minuto se puede abrir un mismo link de pago. */
export const LIMITE_APERTURAS_LINK_POR_MINUTO = 10;

/**
 * HU-033 (BL-203): rate limiting de POST /auth/comensal/link-pago.
 *
 * Cuenta por link, no por IP: detrás del proxy de Railway todos los
 * comensales llegan con la misma IP, y el de un local comparte el Wi-Fi.
 * Un token inventado o adulterado se descarta al descifrarlo, sin tocar la
 * base ni Keycloak; lo que cuesta es abrir una y otra vez un link válido,
 * y eso es lo que se limita. El cupo se guarda con el hash del token, nunca
 * con el token.
 *
 * Los guards corren antes del ValidationPipe: un body sin token comparte un
 * cupo propio («link:sin-token»), que no afecta a los links reales.
 *
 * Usa la configuración global de ThrottlerModule (registrada en
 * MesasModule). El límite real está en el @Throttle de la ruta.
 */
@Injectable()
export class LinkPagoThrottlerGuard extends ThrottlerGuard {
  // La firma de ThrottlerGuard exige una promesa; acá no hay nada que esperar.
  protected getTracker(req: Record<string, any>): Promise<string> {
    const token: unknown = req.body?.linkToken;
    if (typeof token !== 'string' || token === '') {
      return Promise.resolve('link:sin-token');
    }
    const hash = createHash('sha256').update(token).digest('hex');
    return Promise.resolve(`link:${hash}`);
  }
}
