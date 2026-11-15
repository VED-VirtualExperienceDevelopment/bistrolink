import { Injectable, Logger } from '@nestjs/common';
import {
  type MedioDePagoMp,
  type TarjetaAceptada,
  tarjetasAceptadas,
} from './tarjetas-aceptadas';

const MP_API_BASE_URL_POR_DEFECTO = 'https://api.mercadopago.com';
/** La lista casi no cambia: se pide a Mercado Pago cada 6 horas. */
export const VIGENCIA_TARJETAS_MS = 6 * 60 * 60 * 1000;
/** Si Mercado Pago falla, se vuelve a probar a los 5 minutos, no antes. */
export const REINTENTO_TARJETAS_MS = 5 * 60 * 1000;
/** Si Mercado Pago no responde en este tiempo, sin lista. */
const LIMITE_RESPUESTA_MS = 5_000;

/**
 * HU-051 (BL-563): las tarjetas que acepta la cuenta de Mercado Pago de la
 * plataforma (MP_ACCESS_TOKEN, la misma con la que se cobra), en caché.
 *
 * - Un solo pedido a Mercado Pago por vez y por vigencia, aunque muchos
 *   comensales abran el pago a la vez.
 * - Nunca lanza: sin token, con un error o sin respuesta, devuelve la
 *   última lista buena o una vacía, y el sello muestra solo el texto. El
 *   pago no depende de esto.
 * - Al navegador le llega solo id, nombre, imagen y tipo de cada marca.
 */
@Injectable()
export class TarjetasAceptadasService {
  private readonly logger = new Logger(TarjetasAceptadasService.name);
  private lista: TarjetaAceptada[] = [];
  private venceEn = 0;
  private enCurso?: Promise<TarjetaAceptada[]>;

  async obtener(ahora: number = Date.now()): Promise<TarjetaAceptada[]> {
    if (ahora < this.venceEn) return this.lista;
    this.enCurso ??= this.pedir(ahora).finally(() => {
      this.enCurso = undefined;
    });
    return this.enCurso;
  }

  private async pedir(ahora: number): Promise<TarjetaAceptada[]> {
    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
      this.venceEn = ahora + REINTENTO_TARJETAS_MS;
      return this.lista;
    }
    let base = process.env.MP_API_BASE_URL || MP_API_BASE_URL_POR_DEFECTO;
    while (base.endsWith('/')) base = base.slice(0, -1);
    try {
      const respuesta = await fetch(`${base}/v1/payment_methods`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(LIMITE_RESPUESTA_MS),
      });
      if (!respuesta.ok) {
        throw new Error(`Mercado Pago respondió ${respuesta.status}`);
      }
      const cuerpo: unknown = await respuesta.json();
      if (!Array.isArray(cuerpo)) {
        throw new Error('respuesta inesperada de Mercado Pago');
      }
      this.lista = tarjetasAceptadas(cuerpo as MedioDePagoMp[]);
      this.venceEn = ahora + VIGENCIA_TARJETAS_MS;
    } catch (error) {
      this.logger.warn(
        `No se pudieron leer las tarjetas aceptadas: ${(error as Error).message}`,
      );
      this.venceEn = ahora + REINTENTO_TARJETAS_MS;
    }
    return this.lista;
  }
}
