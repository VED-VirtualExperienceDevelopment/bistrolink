import { Injectable, Logger } from '@nestjs/common';

// Las URLs se leen en cada llamada (no al cargar el módulo): así los tests
// de contrato pueden apuntar el cliente al mock de Pact (BL-216).
const authUrl = () =>
  process.env.SURTEC_AUTH_URL ?? 'https://auth-test.facturaelectronica.com.uy';
const apiUrl = () =>
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

/** Tipos de CFE que emite BistroLink (códigos de DGI). */
export const TIPO_CFE = {
  E_TICKET: 101,
  E_FACTURA: 111,
  // HU-024 (BL-104): notas de crédito que anulan un e-Ticket o una e-Factura.
  NC_E_TICKET: 102,
  NC_E_FACTURA: 112,
} as const;

/**
 * HU-024 (BL-104): CFE al que se refiere una nota de crédito (campo
 * `referencias` de POST /comprobantes/crear, referencia específica).
 */
export interface ReferenciaCfe {
  /** Código DGI del CFE referenciado: 101 o 111. */
  tipoComprobante: number;
  serie: string;
  numero: number;
  /** Fecha de emisión del referenciado, AAAA-MM-DD. */
  fecha: string;
  /** Motivo (hasta 90 caracteres). */
  razon: string;
}

/** HU-009 (BL-453): receptor de la e-Factura, ya validado. */
export interface ReceptorEFactura {
  /** 12 dígitos, sin separadores. */
  rut: string;
  razonSocial: string;
}

// Objeto `cliente` de POST /comprobantes/crear (guía de la API de Surtec).
interface ClienteCfe {
  tipo_doc: number;
  cod_pais_doc: string;
  nro_doc: string;
  denominacion: string;
}

/**
 * Campos con datos del receptor que no van al mensaje del error (termina en
 * los logs): si Surtec los repite en su respuesta, se ocultan.
 */
const CAMPOS_DEL_RECEPTOR = new Set([
  'cliente',
  'receptor',
  'nro_doc',
  'denominacion',
]);

/** El cuerpo de un error de Surtec, para el log, sin datos del receptor. */
export function cuerpoParaLog(datos: unknown): string {
  return JSON.stringify(datos, (clave, valor: unknown) =>
    CAMPOS_DEL_RECEPTOR.has(clave) ? '[oculto]' : valor,
  );
}

/** HU-009 (BL-454): el PDF de un CFE emitido, ya validado. */
export interface PdfCfe {
  contenido: Buffer;
}

/** Tope del PDF que se acepta de Surtec (un A4 ronda los 200 KB). */
export const TAMANO_MAXIMO_PDF_CFE = 10 * 1024 * 1024;

/**
 * Valida la respuesta de GET /comprobantes/{id}/pdf: Surtec devuelve un JSON
 * `{ file_name, mime_type, format, data }` con el PDF en base64 en `data`.
 * Lanza SurtecError si no es un PDF.
 */
export function leerPdf(datos: unknown): PdfCfe {
  const raiz = (datos ?? {}) as Record<string, unknown>;
  const tipo = raiz.mime_type;
  if (typeof tipo === 'string' && !tipo.toLowerCase().includes('pdf')) {
    throw new SurtecError(`Surtec devolvió un archivo que no es PDF (${tipo})`);
  }
  if (typeof raiz.data !== 'string' || raiz.data.length === 0) {
    throw new SurtecError('Surtec devolvió el PDF vacío');
  }
  const contenido = Buffer.from(raiz.data, 'base64');
  if (contenido.length > TAMANO_MAXIMO_PDF_CFE) {
    throw new SurtecError('El PDF de Surtec supera el tamaño máximo');
  }
  if (contenido.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new SurtecError('Surtec devolvió un archivo que no es PDF');
  }
  return { contenido };
}

/** HU-009 (BL-455): consulta de los CFE emitidos por un emisor. */
export interface ConsultaEmitidos {
  rutEmisor: string;
  /** Fechas de emisión, AAAA-MM-DD (hora de Uruguay). */
  fechaDesde: string;
  fechaHasta: string;
}

/** Lo que BistroLink lee de cada CFE de la consulta (sin datos del receptor). */
export interface CfeEmitidoConEstado {
  id: string;
  serie: string;
  numero: number;
  /** AE, BE o CE; null si DGI todavía no respondió. */
  codigoDgi: string | null;
  motivoDgi: string | null;
}

/**
 * Lee la respuesta de la consulta. La guía de Surtec no es consistente con
 * los nombres: la tabla dice `comprobante` (array) y `estado_dgi`, y el
 * ejemplo usa `comprobantes` y `estado`. Se aceptan las dos formas; lo que
 * no tiene id, serie o número se descarta.
 */
export function leerEmitidos(datos: unknown): CfeEmitidoConEstado[] {
  const raiz = (datos ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(datos)
    ? datos
    : (raiz.comprobantes ?? raiz.comprobante);
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((c: Record<string, any>) => {
    if (c?.id === undefined || !c.serie || c.numero === undefined) return [];
    const estado = (c.estado_dgi ?? c.estado ?? {}) as Record<string, unknown>;
    const codigo = typeof estado === 'string' ? estado : estado.codigo;
    const motivo = estado.motivo ?? estado.razon ?? estado.descripcion;
    return [
      {
        id: String(c.id),
        serie: String(c.serie),
        numero: Number(c.numero),
        codigoDgi:
          typeof codigo === 'string' && codigo.trim() !== ''
            ? codigo.trim().toUpperCase()
            : null,
        motivoDgi:
          typeof motivo === 'string' && motivo.trim() !== ''
            ? motivo.trim()
            : null,
      },
    ];
  });
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

  /** e-Ticket (101): consumidor final, sin datos del receptor. */
  emitirETicket(solicitud: SolicitudEmision): Promise<CfeEmitido> {
    return this.emitir(TIPO_CFE.E_TICKET, solicitud);
  }

  /**
   * HU-009 (BL-453): e-Factura (111) a nombre del RUT del comensal. Surtec
   * exige el objeto `cliente` con el documento y la denominación; dirección
   * y ciudad son opcionales (Surtec pone «N/D»).
   */
  emitirEFactura(
    solicitud: SolicitudEmision,
    receptor: ReceptorEFactura,
  ): Promise<CfeEmitido> {
    return this.emitir(TIPO_CFE.E_FACTURA, solicitud, {
      tipo_doc: 2, // RUT
      cod_pais_doc: 'UY',
      nro_doc: receptor.rut,
      denominacion: receptor.razonSocial,
    });
  }

  /**
   * HU-024 (BL-104): nota de crédito (102 de un e-Ticket, 112 de una
   * e-Factura) que anula el CFE referenciado. Los importes van positivos;
   * el tipo dice que es una nota de crédito. La de una e-Factura lleva el
   * mismo receptor.
   */
  async emitirNotaDeCredito(
    solicitud: SolicitudEmision,
    referencia: ReferenciaCfe,
    receptor?: ReceptorEFactura,
  ): Promise<CfeEmitido> {
    const deEFactura = referencia.tipoComprobante === TIPO_CFE.E_FACTURA;
    const referencias = [
      {
        tipo_comprobante: referencia.tipoComprobante,
        serie: referencia.serie,
        numero: referencia.numero,
        fecha: referencia.fecha,
        razon: referencia.razon.slice(0, 90),
      },
    ];
    if (!deEFactura) {
      return this.emitir(
        TIPO_CFE.NC_E_TICKET,
        solicitud,
        undefined,
        referencias,
      );
    }
    if (!receptor) {
      throw new SurtecError(
        'La nota de crédito de una e-Factura necesita el receptor de la e-Factura',
      );
    }
    return this.emitir(
      TIPO_CFE.NC_E_FACTURA,
      solicitud,
      {
        tipo_doc: 2, // RUT
        cod_pais_doc: 'UY',
        nro_doc: receptor.rut,
        denominacion: receptor.razonSocial,
      },
      referencias,
    );
  }

  private async emitir(
    tipoComprobante: number,
    solicitud: SolicitudEmision,
    cliente?: ClienteCfe,
    referencias?: Record<string, unknown>[],
  ): Promise<CfeEmitido> {
    const cuerpo = {
      sucursal: Number(process.env.SURTEC_SUCURSAL ?? 1),
      tipo_comprobante: tipoComprobante,
      forma_pago: 1, // contado
      moneda: 'UYU',
      cod_montos_brutos: 1, // los precios incluyen IVA
      id_externo: solicitud.idExterno,
      ...(cliente ? { cliente } : {}),
      items: solicitud.items.map((i) => ({
        cantidad: i.cantidad,
        concepto: i.concepto,
        precio: i.precio,
        indicador_facturacion: 3, // tasa básica (22 %)
        unidad: 'Un',
      })),
      ...(referencias ? { referencias } : {}),
      ...(solicitud.adenda ? { adenda: { texto: solicitud.adenda } } : {}),
    };

    const respuesta = await this.llamar(
      `${apiUrl()}/comprobantes/crear`,
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

  /**
   * HU-009 (BL-455): CFE emitidos en un rango de fechas de emisión, con su
   * estado ante la DGI (GET /consulta/comprobantes/emitidos). La API no
   * filtra por id: se pide el rango y se empareja del lado de BistroLink.
   */
  async consultarEmitidos(
    consulta: ConsultaEmitidos,
  ): Promise<CfeEmitidoConEstado[]> {
    const parametros = new URLSearchParams({
      FechaDesde: consulta.fechaDesde,
      FechaHasta: consulta.fechaHasta,
      Sucursal: String(Number(process.env.SURTEC_SUCURSAL ?? 1)),
    });
    const datos = await this.llamar(
      `${apiUrl()}/consulta/comprobantes/emitidos?${parametros.toString()}`,
      consulta.rutEmisor,
    );
    return leerEmitidos(datos);
  }

  /**
   * HU-009 (BL-454): el PDF A4 de un CFE emitido, por el id de Surtec
   * (comprobante_fiscal.proveedor_ref). No se guarda: Surtec conserva los
   * comprobantes los 5 años que exige la DGI.
   */
  async obtenerPdf(rutEmisor: string, idSurtec: string): Promise<PdfCfe> {
    const datos = await this.llamar(
      `${apiUrl()}/comprobantes/${encodeURIComponent(idSurtec)}/pdf`,
      rutEmisor,
    );
    return leerPdf(datos);
  }

  // Si el token fue rechazado (401) se pide uno nuevo y se reintenta una vez.
  // Con cuerpo es un POST (emisión); sin cuerpo, un GET (consulta).
  private async llamar(
    url: string,
    rutEmisor: string,
    cuerpo?: unknown,
    reintento = true,
  ): Promise<Record<string, any>> {
    const token = await this.token();
    const respuesta = await fetch(url, {
      method: cuerpo === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Emisor': rutEmisor,
        ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
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
        `Surtec rechazó ${cuerpo === undefined ? 'la consulta' : 'la emisión'} (HTTP ${respuesta.status}): ${cuerpoParaLog(datos).slice(0, 500)}`,
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

  private async pedirToken(
    cuerpo: { grant_type: string } & Record<string, unknown>,
  ) {
    const respuesta = await fetch(`${authUrl()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(10_000),
    });
    if (!respuesta.ok) {
      // Nunca se loguea el cuerpo enviado: lleva la contraseña.
      Logger.warn(SurtecClient.name);
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
