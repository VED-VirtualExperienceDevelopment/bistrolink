import { Injectable } from '@nestjs/common';

/**
 * BL-526: `GET /` responde JSON, como el resto de la API. Antes respondía el
 * texto «Hello World!» de la plantilla de Nest como `text/html`, y el DAST
 * lo marcaba (alerta 100001, Unexpected Content-Type). Sigue respondiendo
 * 200; los chequeos de salud usan `/health` (health.controller.ts).
 */
export interface EstadoServicio {
  servicio: string;
  estado: 'ok';
}

@Injectable()
export class AppService {
  estado(): EstadoServicio {
    return { servicio: 'bistrolink-api', estado: 'ok' };
  }
}
