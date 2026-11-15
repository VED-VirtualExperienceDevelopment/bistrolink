import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Cuántos envíos por minuto se aceptan para un mismo pedido. */
export const LIMITE_VALORACIONES_POR_PEDIDO = 5;

/**
 * HU-050 (BL-558): límite de envíos de la valoración. Cuenta por pedido, no
 * por IP: detrás del proxy de Railway todos los comensales llegan con la
 * misma. Un pedido se valora una sola vez (la base lo impide); esto corta
 * los reintentos en masa antes de llegar a la base.
 *
 * Usa la configuración global de ThrottlerModule (registrada en
 * MesasModule). El límite real está en el @Throttle de la ruta.
 */
@Injectable()
export class ValoracionThrottlerGuard extends ThrottlerGuard {
  // La firma de ThrottlerGuard exige una promesa; acá no hay nada que esperar.
  protected getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(
      `valoracion:pedido:${String(req.params?.pedidoId ?? '')}`,
    );
  }
}
