/**
 * HU-012 (BL-108): lógica pura del dashboard /admin/reportes (probada en
 * test/unitarios/reportes.utils.spec.ts). La pantalla y el hook useReportes
 * solo la usan.
 */
import { hoyEnUruguay } from "@/components/admin/comprobantes/comprobantes.utils";
import { formatearPrecio } from "@/components/pago/pago.utils";

export type Periodo =
  "HOY" | "AYER" | "ULTIMOS_7_DIAS" | "MES_ACTUAL" | "PERSONALIZADO";

export type Canal = "TODOS" | "LOCAL" | "WEB" | "WHATSAPP";

export type MetricaVentas = "monto" | "pedidos";
export type MetricaPlatos = "cantidad" | "recaudado";

export const PERIODOS: readonly { valor: Periodo; etiqueta: string }[] = [
  { valor: "HOY", etiqueta: "Hoy" },
  { valor: "AYER", etiqueta: "Ayer" },
  { valor: "ULTIMOS_7_DIAS", etiqueta: "Últimos 7 días" },
  { valor: "MES_ACTUAL", etiqueta: "Mes actual" },
  { valor: "PERSONALIZADO", etiqueta: "Personalizado" },
];

/**
 * Canales del filtro (D1). WhatsApp todavía no recibe pedidos: se muestra
 * deshabilitado, como «Próximamente».
 */
export const CANALES: readonly {
  valor: Canal;
  etiqueta: string;
  descripcion: string;
  proximamente?: boolean;
}[] = [
  { valor: "TODOS", etiqueta: "Todos", descripcion: "Todos los canales" },
  {
    valor: "LOCAL",
    etiqueta: "En el local",
    descripcion: "Pedidos desde el QR de la mesa y los que carga el mozo",
  },
  {
    valor: "WEB",
    etiqueta: "Web",
    descripcion: "Pedidos para retirar, hechos fuera del local",
  },
  {
    valor: "WHATSAPP",
    etiqueta: "WhatsApp",
    descripcion: "Todavía no recibe pedidos",
    proximamente: true,
  },
];

/** Respuesta de GET /admin/reportes. */
export interface TotalesVentas {
  totalVendido: number;
  pedidos: number;
}

export interface VentaPorHora {
  /** Hora del día en la zona del local (0 a 23). */
  hora: number;
  monto: number;
  pedidos: number;
}

export interface PlatoVendido {
  itemCartaId: string;
  nombre: string;
  cantidad: number;
  recaudado: number;
}

export type RotacionMesas =
  | { aplica: false }
  | {
      aplica: true;
      sesiones: number;
      mesas: number;
      rotacion: number;
      ocupacionPromedioMin: number;
    };

export interface ReporteVentas {
  rango: { desde: string; hasta: string; timezone: string };
  canal: Canal;
  resumen: TotalesVentas & { ticketPromedio: number; anterior: TotalesVentas };
  porLugar: { local: number; web: number; whatsapp: number };
  ventasPorHora: VentaPorHora[];
  platosMasPedidos: {
    porCantidad: PlatoVendido[];
    porRecaudado: PlatoVendido[];
  };
  rotacionMesas: RotacionMesas;
}

export interface FiltrosReportes {
  periodo: Periodo;
  canal: Canal;
  /** AAAA-MM-DD; solo se usan con el período personalizado. */
  desde: string;
  hasta: string;
}

/** Al abrir: hoy, todos los canales. */
export function filtrosIniciales(ahora: Date = new Date()): FiltrosReportes {
  const hoy = hoyEnUruguay(ahora);
  return { periodo: "HOY", canal: "TODOS", desde: hoy, hasta: hoy };
}

/** Período personalizado sin fechas o con «desde» posterior a «hasta». */
export function rangoInvalido(filtros: FiltrosReportes): boolean {
  if (filtros.periodo !== "PERSONALIZADO") return false;
  return !filtros.desde || !filtros.hasta || filtros.desde > filtros.hasta;
}

export function rutaReportes(filtros: FiltrosReportes): string {
  const parametros = new URLSearchParams({
    periodo: filtros.periodo,
    canal: filtros.canal,
  });
  if (filtros.periodo === "PERSONALIZADO") {
    parametros.set("desde", filtros.desde);
    parametros.set("hasta", filtros.hasta);
  }
  return `/admin/reportes?${parametros.toString()}`;
}

/** Contra qué se compara cada período (el anterior de igual duración). */
const COMPARACION: Record<Periodo, string> = {
  HOY: "vs. ayer",
  AYER: "vs. anteayer",
  ULTIMOS_7_DIAS: "vs. los 7 días anteriores",
  MES_ACTUAL: "vs. los mismos días anteriores",
  PERSONALIZADO: "vs. el período anterior",
};

export interface Variacion {
  sentido: "sube" | "baja" | "igual";
  /** «+12 % vs. ayer». */
  texto: string;
}

/** Variación de una métrica contra el período anterior. */
export function variacion(
  actual: number,
  anterior: number,
  periodo: Periodo,
): Variacion {
  const comparacion = COMPARACION[periodo];
  if (actual === anterior) {
    return { sentido: "igual", texto: `Sin cambios ${comparacion}` };
  }
  const sentido = actual > anterior ? "sube" : "baja";
  if (anterior === 0) {
    return { sentido, texto: `Sin ventas para comparar ${comparacion}` };
  }
  const porcentaje = Math.round(((actual - anterior) / anterior) * 100);
  const signo = porcentaje > 0 ? "+" : "−";
  return {
    sentido,
    texto: `${signo}${Math.abs(porcentaje)} % ${comparacion}`,
  };
}

export function formatearMonto(valor: number): string {
  return formatearPrecio(valor);
}

export function formatearHora(hora: number): string {
  return `${hora} h`;
}

/**
 * Las horas del gráfico: de la primera a la última hora con ventas, sin
 * huecos (una hora sin ventas va en cero, para que el eje sea continuo).
 */
export function horasDelGrafico(ventas: VentaPorHora[]): VentaPorHora[] {
  if (ventas.length === 0) return [];
  const porHora = new Map(ventas.map((v) => [v.hora, v]));
  const primera = Math.min(...ventas.map((v) => v.hora));
  const ultima = Math.max(...ventas.map((v) => v.hora));
  const horas: VentaPorHora[] = [];
  for (let hora = primera; hora <= ultima; hora++) {
    horas.push(porHora.get(hora) ?? { hora, monto: 0, pedidos: 0 });
  }
  return horas;
}

/** La hora con más ventas (la primera si hay empate), o null sin ventas. */
export function horaPico(
  ventas: VentaPorHora[],
  metrica: MetricaVentas,
): VentaPorHora | null {
  return ventas.reduce<VentaPorHora | null>(
    (pico, v) =>
      v[metrica] > 0 && (!pico || v[metrica] > pico[metrica]) ? v : pico,
    null,
  );
}

/**
 * Largo de una barra en % del máximo. Un valor mayor que cero nunca queda
 * en menos de 2 %, para que se vea.
 */
export function largoBarra(valor: number, maximo: number): number {
  if (valor <= 0 || maximo <= 0) return 0;
  return Math.max(2, Math.round((valor / maximo) * 100));
}

export function platosSegun(
  reporte: ReporteVentas,
  metrica: MetricaPlatos,
): PlatoVendido[] {
  return metrica === "cantidad"
    ? reporte.platosMasPedidos.porCantidad
    : reporte.platosMasPedidos.porRecaudado;
}

export interface PartePorLugar {
  clave: "local" | "web" | "whatsapp";
  etiqueta: string;
  monto: number;
  /** % del total vendido, entero. */
  porcentaje: number;
}

/** Ventas dentro y fuera del local, con su % del total. */
export function partesPorLugar(
  porLugar: ReporteVentas["porLugar"],
): PartePorLugar[] {
  const total = porLugar.local + porLugar.web + porLugar.whatsapp;
  const parte = (
    clave: PartePorLugar["clave"],
    etiqueta: string,
  ): PartePorLugar => ({
    clave,
    etiqueta,
    monto: porLugar[clave],
    porcentaje: total > 0 ? Math.round((porLugar[clave] / total) * 100) : 0,
  });
  return [
    parte("local", "En el local"),
    parte("web", "Web"),
    parte("whatsapp", "WhatsApp"),
  ];
}

export const MENSAJE_ROTACION_NO_APLICA =
  "La rotación de mesas se mide solo con las ventas en el local.";

/** «2,4» turnos por mesa. */
export function formatearRotacion(rotacion: number): string {
  return rotacion.toLocaleString("es-UY", { maximumFractionDigits: 1 });
}

/** «hace 12 s», «hace 3 min». */
export function haceCuanto(desde: Date, ahora: Date = new Date()): string {
  const segundos = Math.max(
    0,
    Math.floor((ahora.getTime() - desde.getTime()) / 1000),
  );
  if (segundos < 60) return `hace ${segundos} s`;
  return `hace ${Math.floor(segundos / 60)} min`;
}

/**
 * Eventos del socket del staff (KdsGateway) que cambian el dashboard: un
 * pago aprobado (el resumen de ventas ya se recalculó) y un cambio de estado
 * de mesa (cerrar una mesa suma un turno a la rotación).
 */
export const EVENTOS_REPORTES = [
  "reportes:actualizado",
  "mesa:estado_actualizado",
] as const;

/** Espera desde el último evento antes de volver a pedir los datos (D4). */
export const DEMORA_REFRESCO_MS = 2000;

/**
 * Llama a `accion` una sola vez, `demoraMs` después del último `programar`:
 * una ráfaga de cobros pide los datos una vez, no una por cobro.
 */
export function crearRefrescoDiferido(
  accion: () => void,
  demoraMs: number = DEMORA_REFRESCO_MS,
): { programar: () => void; cancelar: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelar = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    programar: () => {
      cancelar();
      timer = setTimeout(() => {
        timer = undefined;
        accion();
      }, demoraMs);
    },
    cancelar,
  };
}
