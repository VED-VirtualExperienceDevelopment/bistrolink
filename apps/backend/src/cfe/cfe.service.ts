import { Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  CfeEmitido,
  SolicitudEmision,
  SurtecClient,
  SurtecError,
  TIPO_CFE,
} from './surtec.client';
import { aplicaRebaja17934, LEYENDA_REBAJA_17934 } from './rebaja-iva';

// Res. DGI 798/2012: los CFE se conservan 5 años.
const ANIOS_RETENCION = 5;

/**
 * BL-311: espera antes de cada reintento de la emisión en segundo plano
 * (3 intentos en total). Acotado a propósito: si Surtec sigue sin
 * responder, el pago queda APROBADO sin comprobante y lo resuelve la
 * conciliación (HU-023, BL-96). Reintentar no duplica: mismo id_externo.
 */
export const ESPERAS_REINTENTO_CFE_MS = [5_000, 30_000];

/**
 * Vale la pena reintentar: Surtec caído o lento (5xx, 429, timeout, red).
 * Un 4xx (ej. «no es un emisor válido») va a fallar igual: no se reintenta.
 */
/**
 * Adenda del e-Ticket: el pedido y, si el pago tiene la rebaja de IVA de la
 * Ley 17.934 (HU-037, BL-207), la leyenda. El CFE va igual por el total, sin
 * descontar la rebaja: la aplica la administradora del medio de pago.
 */
export function adendaDelPago(pago: {
  pedidoId: string;
  medioPago: string;
  estado: string;
  pedido: { canal: string };
}): string {
  const pedido = `Pedido ${pago.pedidoId.slice(0, 8)}`;
  return aplicaRebaja17934({ ...pago, canal: pago.pedido.canal })
    ? `${pedido}. ${LEYENDA_REBAJA_17934}`
    : pedido;
}

export function esErrorTransitorio(error: unknown): boolean {
  if (error instanceof SurtecError && error.status !== undefined) {
    return error.status >= 500 || error.status === 429;
  }
  // Credenciales rechazadas o Surtec sin configurar: tampoco cambia solo.
  if (error instanceof SurtecError) {
    return false;
  }
  return true; // fetch failed, AbortSignal.timeout, etc.
}

export interface ResumenComprobante {
  /** HU-009 (BL-453): '101' e-Ticket o '111' e-Factura. */
  tipoCfe: string;
  serie: string;
  numero: number;
  urlConsulta: string | null;
}

/**
 * HU-009 (BL-453): Surtec rechazó la e-Factura por los datos (4xx: por
 * ejemplo, un RUT que DGI no tiene como contribuyente). No va a cambiar con
 * un reintento: se emite un e-Ticket. Un 401 ya lo resolvió el cliente.
 */
export function esRechazoDeLaEFactura(error: unknown): boolean {
  return (
    error instanceof SurtecError &&
    error.status !== undefined &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}

/**
 * Clave de idempotencia del e-Ticket que reemplaza a una e-Factura
 * rechazada: distinta de la de la e-Factura, por si Surtec guardó el
 * intento rechazado con esa clave.
 */
export const SUFIJO_ETICKET_DE_RESPALDO = '-et';

/** HU-023 (BL-96): tope del error guardado en pago.cfe_ultimo_error. */
export const LARGO_MAXIMO_ERROR_CFE = 300;

/** HU-023 (BL-96): resultado de un reintento de emisión. */
/**
 * HU-024 (BL-104): sufijo de la clave de idempotencia de la nota de crédito
 * de un pago («bl-<pagoId>-nc»): distinta de la del CFE original.
 */
export const SUFIJO_NOTA_DE_CREDITO = '-nc';

/** HU-024 (BL-104): tipos de CFE de venta y su nota de crédito. */
export const NOTA_DE_CREDITO_DE: Readonly<Record<string, string>> = {
  [String(TIPO_CFE.E_TICKET)]: String(TIPO_CFE.NC_E_TICKET),
  [String(TIPO_CFE.E_FACTURA)]: String(TIPO_CFE.NC_E_FACTURA),
};
const TIPOS_NOTA_DE_CREDITO = new Set(Object.values(NOTA_DE_CREDITO_DE));

/** Fecha AAAA-MM-DD en hora de Uruguay (la del CFE referenciado). */
function fechaEnUruguay(fecha: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montevideo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
}

export interface ResultadoReintentoCfe {
  /** El comprobante emitido (o el que ya tenía); null si no se emitió. */
  comprobante: ResumenComprobante | null;
  /** Por qué falló, sin datos personales; null si no hubo error. */
  error: string | null;
}

@Injectable()
export class CfeService {
  // Emisiones en curso por pago: si el POST del comensal y el webhook de
  // Mercado Pago llegan juntos, se emite una sola vez.
  private readonly enCurso = new Map<
    string,
    Promise<ResumenComprobante | null>
  >();

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly surtec: SurtecClient,
  ) {}

  /** HU-023 (BL-96): sin Surtec configurado no hay nada que conciliar. */
  configurado(): boolean {
    return this.surtec.configurado();
  }

  // Emite el eTicket de un pago APROBADO. Nunca lanza: el cobro ya se hizo y
  // no puede fallar porque falle la facturación. Si no se pudo emitir, el
  // pago queda APROBADO sin comprobante y se reintenta (mismo id_externo, así
  // que Surtec no duplica) o se concilia (HU-023 / BL-96).
  async intentarEmitir(
    tenantId: string,
    pagoId: string,
  ): Promise<ResumenComprobante | null> {
    return (await this.reintentar(tenantId, pagoId)).comprobante;
  }

  /**
   * HU-023 (BL-96): un intento de emisión, sin esperas, que dice qué pasó.
   * Lo usan la conciliación y el «Reintentar ahora» del administrador.
   * Nunca lanza. Si falla, queda registrado en el pago (cfe_intentos,
   * cfe_ultimo_intento_en y cfe_ultimo_error) para espaciar los reintentos.
   * Si ya hay una emisión en curso para el pago, espera esa.
   */
  async reintentar(
    tenantId: string,
    pagoId: string,
  ): Promise<ResultadoReintentoCfe> {
    const actual = this.enCurso.get(pagoId);
    if (actual !== undefined) {
      const comprobante = await actual;
      return {
        comprobante,
        error: comprobante ? null : 'La emisión en curso no se completó',
      };
    }
    const intento = this.emitir(tenantId, pagoId).then(
      (comprobante): ResultadoReintentoCfe => ({ comprobante, error: null }),
      async (error: unknown): Promise<ResultadoReintentoCfe> => {
        registrarFallo(pagoId, error);
        await this.registrarIntentoFallido(tenantId, pagoId, error);
        return { comprobante: null, error: textoDelError(error) };
      },
    );
    this.enCurso.set(
      pagoId,
      intento.then((r) => r.comprobante),
    );
    try {
      return await intento;
    } finally {
      this.enCurso.delete(pagoId);
    }
  }

  /**
   * HU-023 (BL-96): deja en el pago que la emisión falló. Nunca lanza: si no
   * se puede escribir, solo queda en el log (la conciliación lo reintenta
   * igual, sin espaciar).
   */
  private async registrarIntentoFallido(
    tenantId: string,
    pagoId: string,
    error: unknown,
  ): Promise<void> {
    try {
      await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
        tx.pago.update({
          where: { id: pagoId },
          data: {
            cfeIntentos: { increment: 1 },
            cfeUltimoIntentoEn: new Date(),
            cfeUltimoError: textoDelError(error),
          },
        }),
      );
    } catch (error_) {
      Logger.warn(
        `CFE: no se pudo registrar el intento fallido del pago ${pagoId}: ${mensajeDe(error_)}`,
        CfeService.name,
      );
    }
  }

  /**
   * BL-311: emite el eTicket sin hacer esperar a quien llama (el comensal
   * ve «¡Tu pedido ya está en cocina!» apenas se aprueba el pago; la
   * pantalla consulta el comprobante hasta que aparece). Si Surtec falla
   * por algo transitorio, reintenta según ESPERAS_REINTENTO_CFE_MS.
   * Nunca lanza.
   */
  emitirEnSegundoPlano(tenantId: string, pagoId: string): void {
    void this.emitirConReintentos(tenantId, pagoId);
  }

  /**
   * HU-024 (BL-104): emite la nota de crédito del CFE de un pago devuelto
   * (REEMBOLSADO) sin hacer esperar a quien canceló el pedido. Un intento
   * inmediato; si falla, queda registrado en el pago y la conciliación de CFE
   * (BL-96) la reintenta espaciada. Nunca lanza.
   */
  emitirNotaDeCreditoEnSegundoPlano(tenantId: string, pagoId: string): void {
    void this.reintentarNotaDeCredito(tenantId, pagoId);
  }

  /**
   * HU-024 (BL-104): un intento de emitir la nota de crédito de un pago
   * devuelto. Nunca lanza; si falla, lo registra en el pago (cfe_intentos)
   * para que la conciliación espacie los reintentos. Si el pago no tenía
   * CFE, no hay nada que anular: devuelve null sin error.
   */
  async reintentarNotaDeCredito(
    tenantId: string,
    pagoId: string,
  ): Promise<ResultadoReintentoCfe> {
    const clave = `nc:${pagoId}`;
    const actual = this.enCurso.get(clave);
    if (actual !== undefined) {
      const comprobante = await actual;
      return {
        comprobante,
        error: comprobante ? null : 'La emisión en curso no se completó',
      };
    }
    const intento = this.emitirNotaDeCredito(tenantId, pagoId).then(
      (comprobante): ResultadoReintentoCfe => ({ comprobante, error: null }),
      async (error: unknown): Promise<ResultadoReintentoCfe> => {
        Logger.error(
          `CFE: no se pudo emitir la nota de crédito del pago ${pagoId}: ${mensajeDe(error)}`,
          undefined,
          CfeService.name,
        );
        await this.registrarIntentoFallido(tenantId, pagoId, error);
        return { comprobante: null, error: textoDelError(error) };
      },
    );
    this.enCurso.set(
      clave,
      intento.then((r) => r.comprobante),
    );
    try {
      return await intento;
    } finally {
      this.enCurso.delete(clave);
    }
  }

  private async emitirNotaDeCredito(
    tenantId: string,
    pagoId: string,
  ): Promise<ResumenComprobante | null> {
    if (!this.surtec.configurado()) {
      Logger.warn(
        'CFE: Surtec no está configurado, no se emite la nota de crédito',
        CfeService.name,
      );
      return null;
    }
    const { pago, tenant } = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => ({
        pago: await tx.pago.findUnique({
          where: { id: pagoId },
          include: {
            comprobantes: { orderBy: { fechaEmision: 'asc' } },
            pedido: { include: { lineas: true } },
          },
        }),
        tenant: await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { rut: true },
        }),
      }),
    );
    if (pago?.estado !== 'REEMBOLSADO' || !tenant) return null;
    const yaEmitida = pago.comprobantes.find((c) =>
      TIPOS_NOTA_DE_CREDITO.has(c.tipoCfe),
    );
    if (yaEmitida) return resumir(yaEmitida);
    const original = pago.comprobantes.find(
      (c) => NOTA_DE_CREDITO_DE[c.tipoCfe] !== undefined,
    );
    // Sin CFE (por ejemplo, Surtec no lo había emitido): nada que anular.
    if (!original) return null;

    const tipoOriginal = Number(original.tipoCfe);
    const { receptorRut: rut, receptorRazonSocial: razonSocial } = pago.pedido;
    const idExterno = `bl-${pago.id}${SUFIJO_NOTA_DE_CREDITO}`;
    const emitido = await this.surtec.emitirNotaDeCredito(
      {
        rutEmisor: tenant.rut,
        idExterno,
        items: pago.pedido.lineas.map((l) => ({
          concepto: l.nombreSnapshot.slice(0, 100),
          cantidad: l.cantidad,
          precio: l.precioUnitarioSnapshot.toNumber(),
        })),
        adenda: `Cancelación del pedido ${pago.pedidoId.slice(0, 8)}`,
      },
      {
        tipoComprobante: tipoOriginal,
        serie: original.serie,
        numero: original.numero,
        fecha: fechaEnUruguay(original.fechaEmision),
        razon: 'Cancelación del pedido',
      },
      // La de una e-Factura va al mismo receptor. Si sus datos se
      // anonimizaron (BL-453), Surtec la rechaza y queda para revisar.
      rut && razonSocial ? { rut, razonSocial } : undefined,
    );

    const ahora = new Date();
    const retencionHasta = new Date(ahora);
    retencionHasta.setFullYear(retencionHasta.getFullYear() + ANIOS_RETENCION);
    const guardado = await this.tenantPrisma.runInTenantContext(
      tenantId,
      (tx) =>
        tx.comprobanteFiscal.upsert({
          where: { idExterno },
          create: {
            tenantId,
            pedidoId: pago.pedidoId,
            pagoId: pago.id,
            tipoCfe: NOTA_DE_CREDITO_DE[original.tipoCfe],
            serie: emitido.serie,
            numero: emitido.numero,
            hashSha256: emitido.hash ?? null,
            proveedor: 'SURTEC',
            proveedorRef: emitido.id,
            idExterno,
            caeNumero: emitido.caeNumero ?? null,
            caeVencimiento: emitido.caeVencimiento ?? null,
            urlConsulta: emitido.url ?? null,
            fechaEmision: ahora,
            retencionHasta,
          },
          update: {},
        }),
    );
    return resumir(guardado);
  }

  emitirConReintentos(
    tenantId: string,
    pagoId: string,
  ): Promise<ResumenComprobante | null> {
    const actual = this.enCurso.get(pagoId);
    if (actual !== undefined) {
      return actual;
    }
    const emision = this.intentarDesde(tenantId, pagoId, 0).finally(() =>
      this.enCurso.delete(pagoId),
    );
    this.enCurso.set(pagoId, emision);
    return emision;
  }

  // Un intento y, si falla por algo transitorio, el siguiente después de
  // la espera que corresponde. Recursivo en vez de un await dentro de un
  // bucle: los intentos son secuenciales a propósito (cada uno espera al
  // anterior), no se pueden lanzar en paralelo.
  private async intentarDesde(
    tenantId: string,
    pagoId: string,
    intento: number,
  ): Promise<ResumenComprobante | null> {
    try {
      return await this.emitir(tenantId, pagoId);
    } catch (error) {
      const espera = ESPERAS_REINTENTO_CFE_MS[intento];
      if (espera === undefined || !esErrorTransitorio(error)) {
        registrarFallo(pagoId, error);
        // HU-023 (BL-96): la tanda de reintentos cuenta como un intento.
        await this.registrarIntentoFallido(tenantId, pagoId, error);
        return null;
      }
      Logger.warn(
        `CFE: falló la emisión del pago ${pagoId} (intento ${intento + 1}), se reintenta en ${espera / 1000} s: ${mensajeDe(error)}`,
        CfeService.name,
      );
      await esperar(espera);
      return this.intentarDesde(tenantId, pagoId, intento + 1);
    }
  }

  private async emitir(
    tenantId: string,
    pagoId: string,
  ): Promise<ResumenComprobante | null> {
    if (!this.surtec.configurado()) {
      Logger.warn(
        'CFE: Surtec no está configurado, no se emite el comprobante',
        CfeService.name,
      );
      return null;
    }

    const datos = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const pago = await tx.pago.findUnique({
          where: { id: pagoId },
          include: {
            comprobantes: true,
            pedido: { include: { lineas: true } },
          },
        });
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { rut: true },
        });
        return { pago, tenant };
      },
    );

    const { pago, tenant } = datos;
    if (pago?.estado !== 'APROBADO') {
      return null;
    }
    const existente = pago.comprobantes[0];
    if (existente) {
      return resumir(existente);
    }
    if (!tenant) {
      return null;
    }

    const solicitud: SolicitudEmision = {
      rutEmisor: tenant.rut,
      idExterno: `bl-${pago.id}`,
      items: pago.pedido.lineas.map((l) => ({
        concepto: l.nombreSnapshot.slice(0, 100),
        cantidad: l.cantidad,
        precio: l.precioUnitarioSnapshot.toNumber(),
      })),
      adenda: adendaDelPago(pago),
    };
    const { emitido, tipoCfe, idExterno } = await this.emitirSegunReceptor(
      solicitud,
      pago.pedido,
      pago.id,
    );

    const ahora = new Date();
    const retencionHasta = new Date(ahora);
    retencionHasta.setFullYear(retencionHasta.getFullYear() + ANIOS_RETENCION);

    const datosComprobante = {
      tenantId,
      pedidoId: pago.pedidoId,
      pagoId: pago.id,
      tipoCfe,
      serie: emitido.serie,
      numero: emitido.numero,
      hashSha256: emitido.hash ?? null,
      proveedor: 'SURTEC',
      proveedorRef: emitido.id,
      idExterno,
      caeNumero: emitido.caeNumero ?? null,
      caeVencimiento: emitido.caeVencimiento ?? null,
      urlConsulta: emitido.url ?? null,
      fechaEmision: ahora,
      retencionHasta,
    };

    // upsert por id_externo: si dos webhooks llegan a la vez, el segundo no
    // duplica el comprobante.
    const guardado = await this.tenantPrisma.runInTenantContext(
      tenantId,
      (tx) =>
        tx.comprobanteFiscal.upsert({
          where: { idExterno },
          create: datosComprobante,
          update: {},
        }),
    );
    return resumir(guardado);
  }

  /**
   * HU-009 (BL-453): e-Factura si el pedido tiene RUT y razón social (el
   * comensal la pidió y aceptó el aviso de privacidad); si no, e-Ticket. Si
   * Surtec rechaza la e-Factura por los datos, se emite un e-Ticket para no
   * dejar el pago sin comprobante.
   */
  private async emitirSegunReceptor(
    solicitud: SolicitudEmision,
    pedido: {
      receptorRut: string | null;
      receptorRazonSocial: string | null;
    },
    pagoId: string,
  ): Promise<{ emitido: CfeEmitido; tipoCfe: string; idExterno: string }> {
    const { receptorRut: rut, receptorRazonSocial: razonSocial } = pedido;
    if (!rut || !razonSocial) {
      return {
        emitido: await this.surtec.emitirETicket(solicitud),
        tipoCfe: String(TIPO_CFE.E_TICKET),
        idExterno: solicitud.idExterno,
      };
    }
    try {
      return {
        emitido: await this.surtec.emitirEFactura(solicitud, {
          rut,
          razonSocial,
        }),
        tipoCfe: String(TIPO_CFE.E_FACTURA),
        idExterno: solicitud.idExterno,
      };
    } catch (error) {
      if (!esRechazoDeLaEFactura(error)) throw error;
      // El RUT no va al log (dato personal): alcanza con el pago.
      Logger.warn(
        `CFE: Surtec rechazó la e-Factura del pago ${pagoId}, se emite un e-Ticket: ${mensajeDe(error)}`,
        CfeService.name,
      );
      const idExterno = `${solicitud.idExterno}${SUFIJO_ETICKET_DE_RESPALDO}`;
      return {
        emitido: await this.surtec.emitirETicket({ ...solicitud, idExterno }),
        tipoCfe: String(TIPO_CFE.E_TICKET),
        idExterno,
      };
    }
  }
}

// unref: un reintento pendiente no impide que el proceso se apague.
function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

/** El error para guardar en el pago: ya sin datos del receptor (cuerpoParaLog). */
function textoDelError(error: unknown): string {
  return mensajeDe(error).slice(0, LARGO_MAXIMO_ERROR_CFE);
}

function registrarFallo(pagoId: string, error: unknown): void {
  Logger.error(
    `CFE: no se pudo emitir el comprobante del pago ${pagoId}: ${mensajeDe(error)}`,
    undefined,
    CfeService.name,
  );
}

function resumir(c: {
  tipoCfe: string;
  serie: string;
  numero: number;
  urlConsulta: string | null;
}): ResumenComprobante {
  return {
    tipoCfe: c.tipoCfe,
    serie: c.serie,
    numero: c.numero,
    urlConsulta: c.urlConsulta,
  };
}
