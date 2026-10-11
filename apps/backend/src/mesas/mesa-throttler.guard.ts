import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// BL-70: se limita por mesaId, no por IP. Varias mesas de un mismo
// restaurante comparten la misma red/Wi-Fi, así que trackear por IP
// bloquearía a mesas distintas entre sí.
//
// HU-034 (BL-204): si la request trae el QR de la mesa (MesaQrGuard, que va
// antes que este guard), la mesa sale del QR y no del path. Así funciona
// POST /mesas/llamar, que no lleva el id en la URL.
@Injectable()
export class MesaThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.mesaQr?.mesaId ?? req.params.id;
  }
}
