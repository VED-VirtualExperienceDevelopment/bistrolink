import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * BL-163 (HU-027), [S] rate limiting del alta de establecimientos.
 *
 * Cuenta por usuario de plataforma (el `sub` del token), no por IP: el
 * límite es para cada persona del equipo, aunque varias trabajen desde la
 * misma red. Va después de AuthGuard('jwt-plataforma') en @UseGuards, así
 * que req.user siempre está; la IP queda solo como respaldo.
 *
 * Usa la configuración global de ThrottlerModule (registrada en
 * MesasModule; el módulo es global). El límite real de esta ruta está en
 * el @Throttle de PlataformaController.
 */
@Injectable()
export class PlataformaThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.sub ?? req.ip;
  }
}
