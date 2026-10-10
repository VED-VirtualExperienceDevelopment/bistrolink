import { Injectable, Logger } from '@nestjs/common';

const AUTH_URL =
  process.env.SURTEC_AUTH_URL ?? 'https://auth-test.facturaelectronica.com.uy';
const API_URL =
  process.env.SURTEC_API_URL ?? 'https://api-test.facturaelectronica.com.uy';

// El token dura 12 h; se renueva antes de que venza.
const VIDA_TOKEN_MS = 11 * 60 * 60 * 1000;

export interface ItemCfe {
  concepto: string;
  cantidad: number;
  /** Precio unitario con IVA incluido. */
  precio: number;
}

export interface SolicitudEmision {
  /** RUT del emisor (header X-Emisor): el del tenant. */
  rutEmisor: string;
  /** Clave de idempotencia: el mismo id devuelve el mismo comprobante. */
  idExterno: string;
  items: ItemCfe[];
  adenda?: string;
}

export interface CfeEmitido {
  id: string;
  serie: string;
  numero: number;
  hash?: string;
  caeNumero?: string;
  caeVencimiento?: Date;
  /** Consulta QR de DGI. */
  url?: string;
}

export class SurtecError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface RespuestaToken {
  access_token?: string;
  refresh_token?: string;
}

@Injectable()
export class SurtecClient {
  private accessToken?: string;
  private refreshToken?: string;
  private venceEn = 0;

  configurado(): boolean {
    return Boolean(process.env.SURTEC_USER && process.env.SURTEC_PASSWORD);
  }

  async emitirETicket(solicitud: SolicitudEmision): Promise<CfeEmitido> {
    const cuerpo = {
      sucursal: Number(process.env.SURTEC_SUCURSAL ?? 1),
      tipo_comprobante: 101, // eTicket: consumidor final
      forma_pago: 1, // contado
      moneda: 'UYU',
      cod_montos_brutos: 1, // los precios incluyen IVA
      id_externo: solicitud.idExterno,
      items: solicitud.items.map((i) => ({
        cantidad: i.cantidad,
        concepto: i.concepto,
        precio: i.precio,
        indicador_facturacion: 3, // tasa básica (22 %)
        unidad: 'Un',
      })),
      ...(solicitud.adenda ? { adenda: { texto: solicitud.adenda } } : {}),
    };

    const respuesta = await this.llamar(
      `${API_URL}/comprobantes/crear`,
      solicitud.rutEmisor,
      cuerpo,
    );
    if (respuesta.numero === undefined || !respuesta.serie) {
      throw new SurtecError('Surtec respondió sin serie o número');
    }

    return {
      id: String(respuesta.id),
      serie: respuesta.serie,
      numero: respuesta.numero,
      hash: respuesta.hash,
      caeNumero:
        respuesta.cae_numero === undefined
          ? undefined
          : String(respuesta.cae_numero),
      caeVencimiento: respuesta.cae_vencimiento
        ? new Date(respuesta.cae_vencimiento)
        : undefined,
      url: respuesta.url,
    };
  }

  // Si el token fue rechazado (401) se pide uno nuevo y se reintenta una vez.
  private async llamar(
    url: string,
    rutEmisor: string,
    cuerpo: unknown,
    reintento = true,
  ) {
    const token = await this.token();
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Emisor': rutEmisor,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(20_000),
    });

    if (respuesta.status === 401 && reintento) {
      this.accessToken = undefined;
      this.venceEn = 0;
      return this.llamar(url, rutEmisor, cuerpo, false);
    }

    const datos = (await respuesta.json().catch(() => ({}))) as Record<
      string,
      any
    >;
    if (!respuesta.ok) {
      throw new SurtecError(
        `Surtec rechazó la emisión (HTTP ${respuesta.status}): ${JSON.stringify(datos)}`,
        respuesta.status,
      );
    }
    return datos;
  }

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.venceEn) {
      return this.accessToken;
    }
    if (!this.configurado()) {
      throw new SurtecError('SURTEC_USER/SURTEC_PASSWORD no configurados');
    }

    // Primero se intenta renovar con el refresh token; si falla, con usuario
    // y contraseña.
    if (this.refreshToken) {
      const renovado = await this.pedirToken({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
      });
      if (renovado) return renovado;
    }
    const nuevo = await this.pedirToken({
      grant_type: 'password',
      username: process.env.SURTEC_USER,
      password: process.env.SURTEC_PASSWORD,
    });
    if (!nuevo) {
      throw new SurtecError('Surtec no aceptó las credenciales');
    }
    return nuevo;
  }

  private async pedirToken(cuerpo: Record<string, unknown>) {
    const respuesta = await fetch(`${AUTH_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(10_000),
    });
    if (!respuesta.ok) {
      // Nunca se loguea el cuerpo enviado: lleva la contraseña.
      Logger.warn(
        `Surtec: no se pudo obtener el token (${String(cuerpo.grant_type)}, HTTP ${respuesta.status})`,
        SurtecClient.name,
      );
      this.refreshToken = undefined;
      return null;
    }
    const datos = (await respuesta.json()) as RespuestaToken;
    if (!datos.access_token) return null;
    this.accessToken = datos.access_token;
    this.refreshToken = datos.refresh_token;
    this.venceEn = Date.now() + VIDA_TOKEN_MS;
    return datos.access_token;
  }
}
