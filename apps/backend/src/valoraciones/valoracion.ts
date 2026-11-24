/**
 * HU-050 (BL-558): lógica pura de la valoración privada del pedido (probada
 * en test/unitarios/valoraciones.spec.ts).
 */

/** Largo máximo del comentario (igual que la nota general del pedido). */
export const LARGO_MAXIMO_COMENTARIO = 500;

/** Cuántos comentarios devuelve la pantalla del Administrador, como mucho. */
export const MAXIMO_COMENTARIOS = 200;

export const MENSAJE_AUN_NO_ENTREGADO =
  'Podés valorar tu pedido cuando te lo entreguen';
export const CODIGO_YA_VALORADO = 'YA_VALORADO';
export const MENSAJE_YA_VALORADO = 'Ya valoraste este pedido';

/** Saca de una pasada lo que esté entre «<» y «>» (sin regex: lineal). */
function sacarEtiquetas(texto: string): string {
  let resultado = '';
  let desde = 0;
  while (desde < texto.length) {
    const abre = texto.indexOf('<', desde);
    if (abre === -1) break;
    const cierra = texto.indexOf('>', abre + 1);
    // Un «<» sin «>» después no es una etiqueta: queda como texto.
    if (cierra === -1) break;
    resultado += texto.slice(desde, abre);
    desde = cierra + 1;
  }
  return resultado + texto.slice(desde);
}

/**
 * Saca las etiquetas HTML hasta que no quede ninguna (una etiqueta puede
 * armarse al sacar otra: «<scr<b>ipt>»), recorta los espacios y, si queda
 * vacío, devuelve null. El comentario se muestra siempre como texto; esto
 * es una defensa más.
 */
export function limpiarComentario(texto: unknown): string | null {
  if (typeof texto !== 'string') return null;
  let anterior: string;
  let actual = texto;
  do {
    anterior = actual;
    actual = sacarEtiquetas(actual);
  } while (actual !== anterior);
  const limpio = actual.trim();
  return limpio === '' ? null : limpio;
}

export interface CantidadPorEstrellas {
  estrellas: number;
  cantidad: number;
}

export interface ResumenValoraciones {
  total: number;
  /** Con un decimal; null si no hay valoraciones. */
  promedio: number | null;
  /** De 5 a 1 estrellas, siempre las cinco (con 0 si no hay). */
  distribucion: CantidadPorEstrellas[];
}

/** El promedio y la distribución, a partir de los conteos de la base. */
export function resumirValoraciones(
  conteos: readonly CantidadPorEstrellas[],
): ResumenValoraciones {
  const porEstrellas = new Map<number, number>();
  for (const { estrellas, cantidad } of conteos) {
    porEstrellas.set(estrellas, (porEstrellas.get(estrellas) ?? 0) + cantidad);
  }
  const distribucion = [5, 4, 3, 2, 1].map((estrellas) => ({
    estrellas,
    cantidad: porEstrellas.get(estrellas) ?? 0,
  }));
  const total = distribucion.reduce((suma, d) => suma + d.cantidad, 0);
  const puntos = distribucion.reduce(
    (suma, d) => suma + d.estrellas * d.cantidad,
    0,
  );
  return {
    total,
    promedio: total === 0 ? null : Math.round((puntos / total) * 10) / 10,
    distribucion,
  };
}
