/**
 * HU-050 (BL-558): lógica pura de /admin/valoraciones (probada en
 * test/unitarios/valoraciones.utils.spec.ts).
 */
import { hoyEnUruguay } from "@/components/admin/comprobantes/comprobantes.utils";
import type { FiltrosReportes } from "@/components/admin/reportes/reportes.utils";

export interface CantidadPorEstrellas {
  estrellas: number;
  cantidad: number;
}

export interface ComentarioValoracion {
  /** Día del calendario del local (AAAA-MM-DD), sin hora. */
  dia: string;
  estrellas: number;
  comentario: string;
}

/** Respuesta de GET /admin/valoraciones. */
export interface ValoracionesDelPeriodo {
  rango: { desde: string; hasta: string; timezone: string };
  total: number;
  promedio: number | null;
  /** De 5 a 1 estrellas. */
  distribucion: CantidadPorEstrellas[];
  comentarios: ComentarioValoracion[];
  totalComentarios: number;
}

/**
 * Al abrir: los últimos 7 días (en un solo día suele haber pocas). El canal
 * no se usa: la pantalla reutiliza los filtros de período de los reportes.
 */
export function filtrosInicialesValoraciones(
  ahora: Date = new Date(),
): FiltrosReportes {
  const hoy = hoyEnUruguay(ahora);
  return { periodo: "ULTIMOS_7_DIAS", canal: "TODOS", desde: hoy, hasta: hoy };
}

export function rutaValoraciones(filtros: FiltrosReportes): string {
  const parametros = new URLSearchParams({ periodo: filtros.periodo });
  if (filtros.periodo === "PERSONALIZADO") {
    parametros.set("desde", filtros.desde);
    parametros.set("hasta", filtros.hasta);
  }
  return `/admin/valoraciones?${parametros.toString()}`;
}

const FORMATO_PROMEDIO = new Intl.NumberFormat("es-UY", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** «4,3»; sin valoraciones, «—». */
export function formatearPromedio(promedio: number | null): string {
  return promedio === null ? "—" : FORMATO_PROMEDIO.format(promedio);
}

/** Porcentaje entero del total (0 si no hay). */
export function porcentajeDe(cantidad: number, total: number): number {
  return total === 0 ? 0 : Math.round((cantidad / total) * 100);
}

export function textoCantidad(total: number): string {
  return total === 1 ? "1 valoración" : `${total} valoraciones`;
}

/** «14/11/2026», sin hora (el backend no la guarda). */
export function formatearDia(dia: string): string {
  const [anio, mes, diaDelMes] = dia.split("-");
  return `${diaDelMes}/${mes}/${anio}`;
}

/** Aviso cuando hay más comentarios que los que se muestran. */
export function textoComentariosMostrados(
  mostrados: number,
  total: number,
): string | null {
  if (total <= mostrados) return null;
  return `Se muestran los ${mostrados} más recientes de ${total}. Elegí un período más corto para ver el resto.`;
}

/** Cuántas estrellas llenas dibujar para un promedio (redondeado). */
export function estrellasDelPromedio(promedio: number | null): number {
  return promedio === null ? 0 : Math.round(promedio);
}

/**
 * Una clave estable para cada comentario de la lista (la respuesta no trae
 * id, a propósito: no se expone el pedido). Si hay dos iguales el mismo día,
 * se numeran.
 */
export function conClaves(
  comentarios: readonly ComentarioValoracion[],
): (ComentarioValoracion & { clave: string })[] {
  const vistas = new Map<string, number>();
  return comentarios.map((c) => {
    const base = `${c.dia}|${c.estrellas}|${c.comentario}`;
    const repetida = vistas.get(base) ?? 0;
    vistas.set(base, repetida + 1);
    return { ...c, clave: `${base}|${repetida}` };
  });
}
