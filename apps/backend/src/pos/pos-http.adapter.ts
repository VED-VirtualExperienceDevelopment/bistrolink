import {
  ConsultaVentasPos,
  PosAdapter,
  PosNoDisponibleError,
  PosRechazoError,
  VentaDelPos,
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
 * - GET {POS_API_URL}/ventas?establecimiento=&desde=&limite= (BL-489): las
 *   ventas creadas o cambiadas desde `desde`. 200 con `{ ventas: [...] }`.
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
    this.url = sinBarraFinal(url);
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

  async listarVentas({
    establecimiento,
    desde,
    limite,
  }: ConsultaVentasPos): Promise<VentaDelPos[]> {
    const parametros = new URLSearchParams({
      establecimiento,
      desde: desde.toISOString(),
      limite: String(limite),
    });
    const respuesta = await this.llamar(`/ventas?${parametros}`);
    if (respuesta.status !== 200) {
      throw this.errorDe(respuesta.status, 'listar las ventas');
    }
    const ventas = (await this.leerJson(respuesta))?.ventas;
    if (!Array.isArray(ventas)) {
      throw new PosRechazoError(
        'El POS respondió las ventas en un formato desconocido',
        respuesta.status,
      );
    }
    return ventas.map((v) => ventaDelPos(v));
  }

  /** POST con `cuerpo`; GET si no hay cuerpo. */
  private async llamar(ruta: string, cuerpo?: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };
    if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
    try {
      return await fetch(`${this.url}${ruta}`, {
        method: cuerpo === undefined ? 'GET' : 'POST',
        headers,
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
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

/** Saca las barras del final sin regex (evita el backtracking de /\/+$/). */
function sinBarraFinal(url: string): string {
  let fin = url.length;
  while (fin > 0 && url[fin - 1] === '/') fin--;
  return url.slice(0, fin);
}

/**
 * BL-489: valida una venta de la respuesta de GET /ventas. Un dato que falta
 * o con otro tipo es un PosRechazoError: no se importa a medias.
 */
function ventaDelPos(dato: unknown): VentaDelPos {
  const v = (dato ?? {}) as Record<string, unknown>;
  const id = v.id;
  const referencia = v.referencia ?? null;
  const total = Number(v.total);
  const valida =
    (typeof id === 'string' || typeof id === 'number') &&
    (referencia === null || typeof referencia === 'string') &&
    esFecha(v.fecha) &&
    esFecha(v.actualizadaEn) &&
    Number.isFinite(total) &&
    typeof v.medioPago === 'string' &&
    typeof v.anulada === 'boolean';
  if (!valida) {
    throw new PosRechazoError(
      'El POS respondió una venta con datos incompletos',
    );
  }
  return {
    idPos: String(id),
    referencia: referencia as string | null,
    fecha: v.fecha as string,
    total,
    medioPago: v.medioPago as string,
    anulada: v.anulada as boolean,
    actualizadaEn: v.actualizadaEn as string,
  };
}

function esFecha(valor: unknown): valor is string {
  return typeof valor === 'string' && !Number.isNaN(Date.parse(valor));
}
