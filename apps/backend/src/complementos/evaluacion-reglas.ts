import {
  MAXIMO_SUGERENCIAS,
  mejoresConsecuentes,
  MINIMO_PEDIDOS_CON_AMBOS,
  reglasDesdeConteos,
  type ConteosDelLocal,
  type ReglaCalculada,
} from './reglas-complemento';

/**
 * HU-046 (BL-555): validación offline de las reglas de complemento, para
 * Ciencia de Datos (Anexo 2 §8). Lógica pura: el script
 * scripts/evaluar-reglas-complemento.ts lee los pedidos y llama acá.
 *
 * Protocolo (separación temporal):
 * - Entrenamiento: los pedidos pagados de las semanas anteriores. Con ellos
 *   se calculan las reglas, igual que el job nocturno (mismos umbrales), y
 *   el ranking de popularidad de los platos sugeribles.
 * - Prueba: los pedidos pagados de la última semana. En cada pedido con al
 *   menos un plato sugerible y uno que no lo es, se «muestra» la sugerencia
 *   con los platos que no son sugeribles (lo que eligió antes del
 *   complemento) y se mira si alguno de los sugeridos estaba en el pedido.
 * - hit rate@2 = pedidos con acierto / pedidos evaluados.
 * - Se compara con el baseline de popularidad: los 2 sugeribles más pedidos
 *   del entrenamiento (HU-045).
 * - Las reglas se evalúan como funcionan en producción: hasta 2 por reglas
 *   y, sin reglas para ese pedido, el más pedido (CANTIDAD_RESPALDO = 1).
 */

/** Un pedido: los ids distintos de sus platos. */
export type PlatosDelPedido = readonly string[];

/** Sin reglas, en producción se sugiere un solo plato (el más pedido). */
export const CANTIDAD_RESPALDO_EVALUACION = 1;

/** Conteos para las reglas, a partir de una lista de pedidos. */
export function conteosDePedidos(
  pedidos: readonly PlatosDelPedido[],
  sugeribles: ReadonlySet<string>,
): ConteosDelLocal {
  const pedidosPorPlato = new Map<string, number>();
  const pares = new Map<string, number>();
  let total = 0;
  for (const pedido of pedidos) {
    const platos = [...new Set(pedido)];
    if (platos.length === 0) continue;
    total++;
    for (const a of platos) {
      pedidosPorPlato.set(a, (pedidosPorPlato.get(a) ?? 0) + 1);
      for (const b of platos) {
        if (a === b || !sugeribles.has(b)) continue;
        const clave = `${a}\u0000${b}`;
        pares.set(clave, (pares.get(clave) ?? 0) + 1);
      }
    }
  }
  return {
    pedidos: total,
    pedidosPorPlato,
    pares: [...pares.entries()]
      .filter(([, n]) => n >= MINIMO_PEDIDOS_CON_AMBOS)
      .map(([clave, pedidosConAmbos]) => {
        const [antecedenteId, consecuenteId] = clave.split('\u0000');
        return { antecedenteId, consecuenteId, pedidosConAmbos };
      }),
  };
}

/** Los sugeribles ordenados por cantidad de pedidos (a igual, por id). */
export function sugeriblesPorPopularidad(
  conteos: ConteosDelLocal,
  sugeribles: ReadonlySet<string>,
): string[] {
  return [...conteos.pedidosPorPlato.entries()]
    .filter(([id]) => sugeribles.has(id))
    .sort(([idA, a], [idB, b]) => b - a || idA.localeCompare(idB))
    .map(([id]) => id);
}

/** Lo que sugieren las reglas para `entrada`, con el respaldo si no hay. */
export function sugerenciaConReglas(
  reglas: readonly ReglaCalculada[],
  entrada: ReadonlySet<string>,
  candidatos: ReadonlySet<string>,
  populares: readonly string[],
): string[] {
  const porReglas = mejoresConsecuentes(
    reglas.filter(
      (r) => entrada.has(r.antecedenteId) && candidatos.has(r.consecuenteId),
    ),
  );
  if (porReglas.length > 0) return porReglas;
  return populares
    .filter((id) => candidatos.has(id))
    .slice(0, CANTIDAD_RESPALDO_EVALUACION);
}

export interface ResultadoEvaluacion {
  pedidosEntrenamiento: number;
  reglas: number;
  /** Pedidos de prueba con un sugerible y algo más: los que se evalúan. */
  pedidosEvaluados: number;
  aciertosReglas: number;
  aciertosPopularidad: number;
  /** En %, con un decimal. 0 si no hay pedidos evaluados. */
  hitRateReglas: number;
  hitRatePopularidad: number;
}

function porcentaje(aciertos: number, total: number): number {
  return total > 0 ? Math.round((aciertos / total) * 1000) / 10 : 0;
}

export function evaluarReglas({
  entrenamiento,
  prueba,
  sugeribles,
}: {
  entrenamiento: readonly PlatosDelPedido[];
  prueba: readonly PlatosDelPedido[];
  sugeribles: ReadonlySet<string>;
}): ResultadoEvaluacion {
  const conteos = conteosDePedidos(entrenamiento, sugeribles);
  const reglas = reglasDesdeConteos(conteos);
  const populares = sugeriblesPorPopularidad(conteos, sugeribles);

  let evaluados = 0;
  let aciertosReglas = 0;
  let aciertosPopularidad = 0;
  for (const pedido of prueba) {
    const platos = new Set(pedido);
    const objetivo = [...platos].filter((id) => sugeribles.has(id));
    const entrada = new Set([...platos].filter((id) => !sugeribles.has(id)));
    if (objetivo.length === 0 || entrada.size === 0) continue;
    evaluados++;
    // Lo que se puede sugerir: los sugeribles que no eligió antes.
    const candidatos = new Set(
      [...sugeribles].filter((id) => !entrada.has(id)),
    );
    const acierta = (sugeridos: readonly string[]) =>
      sugeridos.some((id) => platos.has(id));
    if (acierta(sugerenciaConReglas(reglas, entrada, candidatos, populares))) {
      aciertosReglas++;
    }
    const baseline = populares
      .filter((id) => candidatos.has(id))
      .slice(0, MAXIMO_SUGERENCIAS);
    if (acierta(baseline)) aciertosPopularidad++;
  }

  return {
    pedidosEntrenamiento: conteos.pedidos,
    reglas: reglas.length,
    pedidosEvaluados: evaluados,
    aciertosReglas,
    aciertosPopularidad,
    hitRateReglas: porcentaje(aciertosReglas, evaluados),
    hitRatePopularidad: porcentaje(aciertosPopularidad, evaluados),
  };
}
