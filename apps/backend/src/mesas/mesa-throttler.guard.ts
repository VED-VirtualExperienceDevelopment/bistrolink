import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// BL-70: se limita por mesaId, no por IP. Varias mesas de un mismo
// restaurante comparten la misma red/Wi-Fi, así que trackear por IP
// bloquearía a mesas distintas entre sí.
@Injectable()
export class MesaThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.params.id;
  }
}
