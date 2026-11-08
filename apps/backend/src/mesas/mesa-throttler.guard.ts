import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// BL-70: se limita por mesa, no por IP. Varias mesas de un mismo
// restaurante comparten la misma red/Wi-Fi, así que trackear por IP
// bloquearía a mesas distintas entre sí.
//
// HU-034 (BL-204): la mesa sale del QR (request.mesaQr), que dejan
// MesaQrGuard y MesaQrObligatoriaGuard; por eso este guard va DESPUÉS de
// los dos. Si llegara sin mesa es un error de configuración de la ruta, no
// del cliente: se corta en vez de compartir un cupo "undefined" entre todas
// las mesas.
@Injectable()
export class MesaThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const mesaId: string | undefined = req.mesaQr?.mesaId;
    if (!mesaId) {
      throw new Error(
        'MesaThrottlerGuard necesita la mesa del QR: va después de MesaQrGuard y MesaQrObligatoriaGuard',
      );
    }
    return mesaId;
  }
}
