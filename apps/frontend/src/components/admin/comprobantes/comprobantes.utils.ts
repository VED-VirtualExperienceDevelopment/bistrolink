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
    enlaceDgi: urlConsultaSegura(c.urlConsulta),
  };
}
