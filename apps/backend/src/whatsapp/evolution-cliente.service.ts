import { Injectable, Logger } from '@nestjs/common';
import { BrokenCircuitError, TaskCancelledError } from 'cockatiel';
import { crearPoliticaResiliencia } from '../pagos/circuit-breaker.provider';
import type { ConfiguracionWhatsapp } from './configuracion-whatsapp';
import { telefonoParaLog } from './mensaje-evolution';

/** Evolution responde en milisegundos; si tarda más, algo anda mal. */
export const TIMEOUT_EVOLUTION_MS = 5_000;

/**
 * HU-010 (BL-112): manda mensajes de texto por Evolution API v2.3
 * (`POST /message/sendText/{instancia}`).
 *
 * Con timeout y circuit breaker (el mismo de la pasarela, BL-77): si
 * Evolution está caído, después de 3 fallos seguidos no se lo llama por
 * 30 s. Un error nunca sale de acá: se loguea (sin el número completo ni
 * el texto) y el bot sigue; el comensal puede volver a escribir.
 */
@Injectable()
export class EvolutionClienteService {
  private readonly logger = new Logger(EvolutionClienteService.name);
  private readonly politica = crearPoliticaResiliencia({
    timeoutMs: TIMEOUT_EVOLUTION_MS,
  });

  /** Manda los mensajes en orden. Devuelve cuántos se mandaron. */
  async enviar(
    config: ConfiguracionWhatsapp,
    instancia: string,
    telefono: string,
    mensajes: string[],
  ): Promise<number> {
    let enviados = 0;
    for (const texto of mensajes) {
      if (!(await this.enviarUno(config, instancia, telefono, texto))) break;
      enviados += 1;
    }
    return enviados;
  }

  private async enviarUno(
    config: ConfiguracionWhatsapp,
    instancia: string,
    telefono: string,
    texto: string,
  ): Promise<boolean> {
    const url = `${config.evolutionUrl}/message/sendText/${encodeURIComponent(instancia)}`;
    try {
      await this.politica.execute(async ({ signal }) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: config.evolutionApiKey,
          },
          body: JSON.stringify({ number: telefono, text: texto }),
          signal,
        });
        if (!res.ok) {
          // Sin el cuerpo: Evolution puede repetir el número o el texto.
          throw new Error(`Evolution respondió ${res.status}`);
        }
      });
      return true;
    } catch (error) {
      const motivo =
        error instanceof BrokenCircuitError
          ? 'circuito abierto'
          : error instanceof TaskCancelledError
            ? `sin respuesta en ${TIMEOUT_EVOLUTION_MS} ms`
            : error instanceof Error
              ? error.message
              : 'error desconocido';
      this.logger.warn(
        `No se pudo mandar el mensaje de WhatsApp a ${telefonoParaLog(telefono)} (instancia ${instancia}): ${motivo}`,
      );
      return false;
    }
  }
}
