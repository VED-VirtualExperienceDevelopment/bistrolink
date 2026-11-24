/**
 * HU-046 (BL-552): análisis de canasta por local. Lógica pura (sin base),
 * para probarla sola: el servicio cuenta en SQL y acá se calculan las
 * métricas y se aplican los umbrales.
 *
 * Método (Anexo 2 §8, propuesta de Ciencia de Datos):
 * - Datos: platos distintos de cada pedido con pago aprobado de los últimos
 *   90 días, por local.
 * - Regla A → B, con B sugerible y sin alcohol.
 * - soporte = pedidos con A y B / pedidos del local
 * - confianza = pedidos con A y B / pedidos con A
 * - lift = confianza / (pedidos con B / pedidos del local)
 * - Umbrales: al menos 5 pedidos con A y B, confianza ≥ 0,2 y lift > 1. Con
 *   poco volumen no hay reglas (las reglas espurias son el riesgo
 *   principal) y se usa el respaldo de popularidad.
 */
export const VENTANA_REGLAS_DIAS = 90;
export const MINIMO_PEDIDOS_CON_AMBOS = 5;
export const CONFIANZA_MINIMA = 0.2;
/** El lift tiene que ser MAYOR que esto: 1 es independencia. */
export const LIFT_MINIMO = 1;
/** Cuántos platos se sugieren como mucho. */
export const MAXIMO_SUGERENCIAS = 2;

/** Pedidos con los dos platos de un par (A → B). */
export interface ParDePlatos {
  antecedenteId: string;
  consecuenteId: string;
  pedidosConAmbos: number;
}

/** Lo que cuenta la consulta del local. */
export interface ConteosDelLocal {
  /** Pedidos pagados del local en la ventana. */
  pedidos: number;
  /** En cuántos de esos pedidos aparece cada plato. */
  pedidosPorPlato: ReadonlyMap<string, number>;
  pares: readonly ParDePlatos[];
}

export interface ReglaCalculada extends ParDePlatos {
  soporte: number;
  confianza: number;
  lift: number;
}

/** Las reglas que cumplen los umbrales, con sus métricas. */
export function reglasDesdeConteos(conteos: ConteosDelLocal): ReglaCalculada[] {
  const { pedidos, pedidosPorPlato, pares } = conteos;
  if (pedidos <= 0) return [];
  const reglas: ReglaCalculada[] = [];
  for (const par of pares) {
    const conA = pedidosPorPlato.get(par.antecedenteId) ?? 0;
    const conB = pedidosPorPlato.get(par.consecuenteId) ?? 0;
    if (
      par.antecedenteId === par.consecuenteId ||
      par.pedidosConAmbos < MINIMO_PEDIDOS_CON_AMBOS ||
      conA <= 0 ||
      conB <= 0
    ) {
      continue;
    }
    const confianza = par.pedidosConAmbos / conA;
    const lift = confianza / (conB / pedidos);
    if (confianza < CONFIANZA_MINIMA || lift <= LIFT_MINIMO) continue;
    reglas.push({
      ...par,
      soporte: par.pedidosConAmbos / pedidos,
      confianza,
      lift,
    });
  }
  return reglas;
}

/** Una regla guardada, con lo que hace falta para ordenarla. */
export interface ReglaParaOrdenar {
  consecuenteId: string;
  confianza: number;
  lift: number;
}

/**
 * Los consecuentes a sugerir, en orden: lift × confianza, quedándose con la
 * mejor regla de cada consecuente (varios platos del pedido pueden llevar
 * al mismo). A igual puntaje, por id, para que el orden sea estable.
 */
export function mejoresConsecuentes(
  reglas: readonly ReglaParaOrdenar[],
  maximo: number = MAXIMO_SUGERENCIAS,
): string[] {
  const mejorPorConsecuente = new Map<string, number>();
  for (const regla of reglas) {
    const puntaje = regla.lift * regla.confianza;
    const actual = mejorPorConsecuente.get(regla.consecuenteId);
    if (actual === undefined || puntaje > actual) {
      mejorPorConsecuente.set(regla.consecuenteId, puntaje);
    }
  }
  return [...mejorPorConsecuente.entries()]
    .sort(([idA, a], [idB, b]) => b - a || idA.localeCompare(idB))
    .slice(0, maximo)
    .map(([id]) => id);
}
