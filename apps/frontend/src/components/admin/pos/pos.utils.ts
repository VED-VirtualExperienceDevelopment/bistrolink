/**
 * HU-011 (BL-488): lógica pura de la pantalla /admin/pos (probada en
 * test/unitarios/pos.utils.spec.ts).
 */
import { codigoPedido, formatearPrecio } from "@/components/pago/pago.utils";

export type EstadoSincronizacionPos =
  "PENDIENTE" | "ENVIADA" | "ERROR" | "DESCARTADA";
export type TipoSincronizacionPos = "VENTA" | "ANULACION";

/** Una fila de GET /admin/pos/sincronizaciones. */
export interface SincronizacionPos {
  id: string;
  tipo: TipoSincronizacionPos;
  estado: EstadoSincronizacionPos;
  pedidoId: string;
  /** Null en un pedido para retirar. */
  mesa: number | null;
  total: number;
  posRef: string | null;
  intentos: number;
  ultimoError: string | null;
  ultimoIntentoEn: string | null;
  enviadaEn: string | null;
  creadaEn: string;
}

export interface PaginaSincronizacionesPos {
  habilitada: boolean;
  /** «mock», «http» o null si la API no tiene un POS configurado. */
  adaptador: string | null;
  sincronizaciones: SincronizacionPos[];
  pagina: number;
  hayMas: boolean;
  total: number;
}

export interface ResultadoReintentoPos {
  id: string;
  estado: EstadoSincronizacionPos;
  ultimoError: string | null;
}

/** Filtro del listado. Vacío: todas. */
export type FiltroEstadoPos = "" | EstadoSincronizacionPos;

export const FILTROS_ESTADO_POS: ReadonlyArray<{
  valor: FiltroEstadoPos;
  texto: string;
}> = [
  { valor: "", texto: "Todas" },
  { valor: "PENDIENTE", texto: "Pendientes" },
  { valor: "ERROR", texto: "Con error" },
  { valor: "ENVIADA", texto: "Enviadas" },
  { valor: "DESCARTADA", texto: "Descartadas" },
];

const NOMBRE_ESTADO: Record<EstadoSincronizacionPos, string> = {
  PENDIENTE: "Pendiente",
  ENVIADA: "En el POS",
  ERROR: "Con error",
  DESCARTADA: "Descartada",
};

const CLASE_ESTADO: Record<EstadoSincronizacionPos, string> = {
  PENDIENTE: "bg-surface-container-high text-on-surface-variant",
  ENVIADA: "bg-primary-container text-on-primary-container",
  ERROR: "bg-error-container text-on-error-container font-semibold",
  DESCARTADA: "bg-surface-container text-on-surface-variant",
};

const FORMATO_FECHA = new Intl.DateTimeFormat("es-UY", {
  timeZone: "America/Montevideo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function rutaSincronizaciones(
  estado: FiltroEstadoPos,
  pagina = 1,
): string {
  const parametros = new URLSearchParams();
  if (estado) parametros.set("estado", estado);
  if (pagina > 1) parametros.set("pagina", String(pagina));
  const query = parametros.toString();
  return query
    ? `/admin/pos/sincronizaciones?${query}`
    : "/admin/pos/sincronizaciones";
}

export function rutaReintentarPos(id: string): string {
  return `/admin/pos/sincronizaciones/${encodeURIComponent(id)}/reintentar`;
}

export const RUTA_CONFIGURACION_POS = "/admin/pos/configuracion";

/** Clases de la etiqueta del estado. */
export function claseEstadoPos(estado: EstadoSincronizacionPos): string {
  return `inline-block rounded-full px-2.5 py-0.5 text-label-md ${CLASE_ESTADO[estado]}`;
}

/** Se puede reintentar a mano: lo que todavía no está en el POS. */
export function sePuedeReintentar(s: SincronizacionPos): boolean {
  return s.estado === "PENDIENTE" || s.estado === "ERROR";
}

/** Detalle del estado, debajo de la etiqueta. */
export function detalleEstado(s: SincronizacionPos): string | null {
  if (s.estado === "ENVIADA") {
    return s.posRef ? `Id en el POS: ${s.posRef}` : null;
  }
  if (s.estado === "DESCARTADA") {
    return "El pedido se canceló antes de mandarse";
  }
  if (s.intentos === 0) return "Se manda en unos segundos";
  const intentos =
    s.intentos === 1 ? "1 intento fallido" : `${s.intentos} intentos fallidos`;
  return s.ultimoError ? `${intentos}: ${s.ultimoError}` : intentos;
}

/** Lo que muestra cada fila, ya formateado. */
export function filaSincronizacion(s: SincronizacionPos) {
  return {
    fecha: FORMATO_FECHA.format(new Date(s.enviadaEn ?? s.creadaEn)),
    pedido: codigoPedido(s.pedidoId),
    origen: s.mesa === null ? "Para retirar" : `Mesa ${s.mesa}`,
    tipo: s.tipo === "VENTA" ? "Venta" : "Anulación",
    total: formatearPrecio(s.total),
    estado: NOMBRE_ESTADO[s.estado],
    detalle: detalleEstado(s),
  };
}

/** Mensaje después de «Reintentar». */
export function mensajeReintentoPos(r: ResultadoReintentoPos): string {
  if (r.estado === "ENVIADA") return "Listo: ya está en el POS.";
  const motivo = r.ultimoError ? `: ${r.ultimoError}` : "";
  // PENDIENTE: el POS no respondió y el sistema la reintenta. ERROR: el POS
  // la rechazó; reintentar sola no lo arregla.
  return r.estado === "PENDIENTE"
    ? `No se pudo mandar${motivo}. Se vuelve a intentar sola.`
    : `El POS no la aceptó${motivo}. Revisá el motivo antes de reintentar.`;
}

/** Texto del estado de la integración, arriba de la lista. */
export function textoIntegracion(
  datos: Pick<PaginaSincronizacionesPos, "habilitada" | "adaptador">,
): string {
  if (datos.adaptador === null) {
    return "La API no tiene un POS configurado. Pedile al equipo de BistroLink que lo conecte.";
  }
  const pos =
    datos.adaptador === "mock" ? "al POS de prueba" : "al POS del local";
  return datos.habilitada
    ? `Cada venta cobrada se manda ${pos} en segundos. Si el POS no responde, se reintenta sola.`
    : `El envío está desactivado: las ventas no se mandan ${pos}.`;
}
