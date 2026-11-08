import {
  PosAdapter,
  PosNoDisponibleError,
  PosRechazoError,
  VentaPos,
  VentaRegistradaPos,
} from './pos.adapter';
import { urlPosValida } from './configuracion-pos';

/**
 * HU-011 (BL-488): adaptador HTTP contra la API de POS que define BistroLink
 * (contrato en test/contract/pos-api.pact.spec.ts). Un POS real se conecta
 * implementando esta API, o con un adaptador propio.
 *
 * - POST {POS_API_URL}/ventas: registra la venta. 201 con `{ id }`; si la
 *   referencia ya existe, 409 con el `id` de la venta existente
 *   (idempotencia).
 * - POST {POS_API_URL}/ventas/{id}/anulacion: la anula. 200; 409 si ya
 *   estaba anulada (se toma como hecho).
 * - Bearer token (POS_API_TOKEN), solo HTTPS, con timeout.
 * - 5xx, 429, red o timeout: PosNoDisponibleError (se reintenta). Otro 4xx:
 *   PosRechazoError (no se reintenta solo). El cuerpo de la respuesta no va
 *   al mensaje: puede traer datos que no queremos en los logs.
 */
export class PosHttpAdapter implements PosAdapter {
  readonly nombre = 'http';
  private readonly url: string;

  constructor(
    url: string,
    private readonly token: string,
    private readonly timeoutMs = 5000,
  ) {
    if (!urlPosValida(url)) {
      throw new Error('POS_API_URL tiene que ser una URL HTTPS');
    }
    this.url = url.replace(/\/+$/, '');
  }

  async registrarVenta(venta: VentaPos): Promise<VentaRegistradaPos> {
    const respuesta = await this.llamar('/ventas', venta);
    if (respuesta.status === 201 || respuesta.status === 409) {
      const id = (await this.leerJson(respuesta))?.id;
      if (typeof id === 'string' || typeof id === 'number') {
        return { idPos: String(id) };
      }
      throw new PosRechazoError(
        'El POS registró la venta pero no devolvió su id',
        respuesta.status,
      );
    }
    throw this.errorDe(respuesta.status, 'registrar la venta');
  }

  async anularVenta(idPos: string, motivo: string): Promise<void> {
    const respuesta = await this.llamar(
      `/ventas/${encodeURIComponent(idPos)}/anulacion`,
      { motivo },
    );
    if (respuesta.status === 200 || respuesta.status === 409) return;
    throw this.errorDe(respuesta.status, 'anular la venta');
  }

  private async llamar(ruta: string, cuerpo: unknown): Promise<Response> {
    try {
      return await fetch(`${this.url}${ruta}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new PosNoDisponibleError(
        `El POS no respondió: ${(error as Error).name}`,
      );
    }
  }

  private async leerJson(
    respuesta: Response,
  ): Promise<Record<string, unknown> | null> {
    try {
      return (await respuesta.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private errorDe(status: number, accion: string): Error {
    if (status >= 500 || status === 429) {
      return new PosNoDisponibleError(
        `El POS no pudo ${accion} (HTTP ${status})`,
      );
    }
    return new PosRechazoError(
      `El POS rechazó ${accion} (HTTP ${status})`,
      status,
    );
  }
}
