import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * BL-386: rate limiting de la subida y la confirmación de imágenes.
 *
 * Cuenta por usuario (el `sub` del token), no por IP: el personal de un
 * restaurante comparte la misma red. Va después de AuthGuard('jwt'), así
 * que req.user siempre está; la IP queda solo como respaldo.
 *
 * Usa la configuración global de ThrottlerModule (registrada en
 * MesasModule). El límite real de cada ruta está en su @Throttle.
 */
@Injectable()
export class MenuAdminThrottlerGuard extends ThrottlerGuard {
  // La firma de ThrottlerGuard exige una promesa; acá no hay nada que esperar.
  protected getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(req.user?.sub ?? req.ip);
  }
}
