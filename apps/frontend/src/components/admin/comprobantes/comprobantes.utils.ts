/**
 * HU-009 (BL-455): lógica pura de la pantalla /admin/comprobantes (probada
 * en test/unitarios/comprobantes.utils.spec.ts).
 */
import { nombreDelComprobante } from "@/components/pago/factura.utils";
import {
  codigoPedido,
  formatearPrecio,
  numeroComprobante,
  urlConsultaSegura,
} from "@/components/pago/pago.utils";

export type EstadoDgi = "PENDIENTE" | "ACEPTADO" | "RECHAZADO" | "OBSERVADO";

/** Una fila de GET /admin/comprobantes. */
export interface Comprobante {
  id: string;
  fechaEmision: string;
  tipoCfe: string;
  serie: string;
  numero: number;
  pedidoId: string;
  /** Null en un pedido para retirar. */
  mesa: number | null;
  canal: string;
  monto: string;
  estadoDgi: EstadoDgi;
  estadoDgiMotivo: string | null;
  urlConsulta: string | null;
}

export interface PaginaComprobantes {
  comprobantes: Comprobante[];
  desde: string;
  hasta: string;
  pagina: number;
  hayMas: boolean;
}

export interface FiltrosComprobantes {
  /** AAAA-MM-DD. */
  desde: string;
  hasta: string;
  /** Vacío: todos. */
  estado: "" | EstadoDgi;
}

/** Hoy en Uruguay, AAAA-MM-DD (en-CA da ese formato). */
export function hoyEnUruguay(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Montevideo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

/** Al abrir: los de hoy, en cualquier estado. */
export function filtrosIniciales(
  ahora: Date = new Date(),
): FiltrosComprobantes {
  const hoy = hoyEnUruguay(ahora);
  return { desde: hoy, hasta: hoy, estado: "" };
}

export function rutaComprobantes(
  filtros: FiltrosComprobantes,
  pagina = 1,
): string {
  const parametros = new URLSearchParams();
  if (filtros.desde) parametros.set("desde", filtros.desde);
  if (filtros.hasta) parametros.set("hasta", filtros.hasta);
  if (filtros.estado) parametros.set("estado", filtros.estado);
  if (pagina > 1) parametros.set("pagina", String(pagina));
  const query = parametros.toString();
  return query ? `/admin/comprobantes?${query}` : "/admin/comprobantes";
}

/** «desde» posterior a «hasta»: el backend respondería 400. */
export function rangoInvalido(filtros: FiltrosComprobantes): boolean {
  return Boolean(
    filtros.desde && filtros.hasta && filtros.desde > filtros.hasta,
  );
}

export const ESTADOS_DGI: ReadonlyArray<{ valor: EstadoDgi; texto: string }> = [
  { valor: "PENDIENTE", texto: "Pendiente" },
  { valor: "ACEPTADO", texto: "Aceptado" },
  { valor: "OBSERVADO", texto: "Observado" },
  { valor: "RECHAZADO", texto: "Rechazado" },
];

export function etiquetaEstadoDgi(estado: EstadoDgi): string {
  return ESTADOS_DGI.find((e) => e.valor === estado)?.texto ?? estado;
}

/** Colores del estado: el rechazado resalta (hay que revisarlo). */
export function claseEstadoDgi(estado: EstadoDgi): string {
  switch (estado) {
    case "ACEPTADO":
      return "bg-[#d7f5dd] text-[#0b5b23]";
    case "RECHAZADO":
      return "bg-error-container text-on-error-container font-semibold";
    case "OBSERVADO":
      return "bg-[#fff0c2] text-[#5c4300]";
    default:
      return "bg-surface-container-high text-on-surface-variant";
  }
}

const FORMATO_FECHA = new Intl.DateTimeFormat("es-UY", {
  timeZone: "America/Montevideo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Debajo del estado: el motivo que informó la DGI o, si sigue pendiente,
 * por qué. Surtec manda los CFE a la DGI por tandas: un comprobante recién
 * emitido puede estar un rato «no enviado» (código NE).
 */
export const DETALLE_PENDIENTE =
  "Todavía no enviado a la DGI o sin respuesta. Se actualiza solo.";

export function detalleEstadoDgi(c: Comprobante): string | null {
  if (c.estadoDgiMotivo) return c.estadoDgiMotivo;
  return c.estadoDgi === "PENDIENTE" ? DETALLE_PENDIENTE : null;
}

/** Lo que muestra cada fila, ya formateado. */
export function filaComprobante(c: Comprobante) {
  return {
    fecha: FORMATO_FECHA.format(new Date(c.fechaEmision)),
    tipo: nombreDelComprobante(c.tipoCfe),
    numero: numeroComprobante(c.serie, c.numero),
    pedido: codigoPedido(c.pedidoId),
    origen: c.mesa === null ? "Para retirar" : `Mesa ${c.mesa}`,
    monto: formatearPrecio(c.monto),
    estado: etiquetaEstadoDgi(c.estadoDgi),
    detalle: detalleEstadoDgi(c),
    enlaceDgi: urlConsultaSegura(c.urlConsulta),
  };
}

// ── HU-023 (BL-96): pendientes de emisión ────────────────────────────────

/** Un pago aprobado sin CFE (GET /admin/comprobantes/pendientes). */
export interface PendienteEmision {
  pagoId: string;
  pedidoId: string;
  mesa: number | null;
  canal: string;
  monto: string;
  medioPago: string;
  fecha: string;
  intentos: number;
  ultimoIntentoEn: string | null;
  ultimoError: string | null;
  requiereAtencion: boolean;
  proximoIntentoEn: string | null;
}

export interface PaginaPendientesEmision {
  pendientes: PendienteEmision[];
  total: number;
  pagina: number;
  hayMas: boolean;
}

/** Respuesta de POST .../pendientes/:pagoId/reintentar. */
export interface ResultadoReintento {
  emitido: boolean;
  comprobante: { tipoCfe: string; serie: string; numero: number } | null;
  error: string | null;
}

export function rutaPendientes(pagina = 1): string {
  return pagina > 1
    ? `/admin/comprobantes/pendientes?pagina=${pagina}`
    : "/admin/comprobantes/pendientes";
}

export function rutaReintentar(pagoId: string): string {
  return `/admin/comprobantes/pendientes/${encodeURIComponent(pagoId)}/reintentar`;
}

const NOMBRE_MEDIO: Record<string, string> = {
  MERCADOPAGO: "Tarjeta (Mercado Pago)",
  PLEXO: "Tarjeta (Plexo)",
  EFECTIVO: "Efectivo",
};

const FORMATO_HORA = new Intl.DateTimeFormat("es-UY", {
  timeZone: "America/Montevideo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Estado del pendiente para mostrar. */
export function estadoPendiente(p: PendienteEmision): string {
  if (p.requiereAtencion) return "Requiere atención";
  if (p.intentos === 0) return "Se emite en unos minutos";
  return p.proximoIntentoEn
    ? `Reintentando · próximo intento ${FORMATO_HORA.format(new Date(p.proximoIntentoEn))}`
    : "Reintentando";
}

/** Lo que muestra cada fila de pendientes, ya formateado. */
export function filaPendiente(p: PendienteEmision) {
  return {
    fecha: FORMATO_FECHA.format(new Date(p.fecha)),
    pedido: codigoPedido(p.pedidoId),
    origen: p.mesa === null ? "Para retirar" : `Mesa ${p.mesa}`,
    monto: formatearPrecio(p.monto),
    medio: NOMBRE_MEDIO[p.medioPago] ?? p.medioPago,
    intentos:
      p.intentos === 1
        ? "1 intento fallido"
        : `${p.intentos} intentos fallidos`,
    estado: estadoPendiente(p),
  };
}

/** Mensaje después de «Reintentar ahora». */
export function mensajeReintento(r: ResultadoReintento): string {
  if (r.emitido && r.comprobante) {
    const { tipoCfe, serie, numero } = r.comprobante;
    // «la» e-Factura, «el» e-Ticket.
    const articulo = tipoCfe === "111" ? "la" : "el";
    return `Listo: se emitió ${articulo} ${nombreDelComprobante(tipoCfe)} ${numeroComprobante(serie, numero)}.`;
  }
  return r.error
    ? `No se pudo emitir: ${r.error}`
    : "No se pudo emitir el comprobante. Probá de nuevo más tarde.";
}
