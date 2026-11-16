/**
 * HU-050 (BL-558): lógica pura de la valoración privada del pedido (probada
 * en test/unitarios/valoracion.utils.spec.ts).
 */
import { ApiError } from "@/lib/api-client";

/** Igual que el backend (LARGO_MAXIMO_COMENTARIO). */
export const LARGO_MAXIMO_COMENTARIO = 500;
export const CODIGO_YA_VALORADO = "YA_VALORADO";

/** Qué significa cada cantidad de estrellas, de 1 a 5. */
export const ETIQUETAS_ESTRELLAS = [
  "Malo",
  "Regular",
  "Bueno",
  "Muy bueno",
  "Excelente",
] as const;

export const ESTRELLAS = [1, 2, 3, 4, 5] as const;

export interface Valoracion {
  estrellas: number;
  comentario?: string;
}

export function rutaValoracion(pedidoId: string): string {
  return `/pedidos/${encodeURIComponent(pedidoId)}/valoracion`;
}

/** Nombre accesible de cada opción: «4 de 5: Muy bueno». */
export function nombreEstrella(estrellas: number): string {
  return `${estrellas} de 5: ${ETIQUETAS_ESTRELLAS[estrellas - 1]}`;
}

/** Lo que se manda: el comentario solo si tiene algo (recortado). */
export function cuerpoValoracion(
  estrellas: number,
  comentario: string,
): Valoracion {
  const texto = comentario.trim();
  return texto ? { estrellas, comentario: texto } : { estrellas };
}

export type ResultadoValoracion =
  | { tipo: "enviada" }
  | { tipo: "ya-valorada" }
  | { tipo: "error"; mensaje: string };

export const MENSAJE_ERROR_VALORACION =
  "No se pudo enviar la valoración. Probá de nuevo.";
export const MENSAJE_DEMASIADOS_INTENTOS =
  "Hiciste varios intentos seguidos. Esperá un minuto y probá de nuevo.";

/**
 * Qué mostrar si el envío falla. Si el pedido ya tenía valoración (otra
 * pestaña, un doble toque), no es un error: se muestra como enviada. Los
 * mensajes del backend para 409 y 410 (mesa cerrada) ya están redactados
 * para el comensal.
 */
export function resultadoDelError(error: unknown): ResultadoValoracion {
  if (!(error instanceof ApiError)) {
    return { tipo: "error", mensaje: MENSAJE_ERROR_VALORACION };
  }
  if (error.codigo === CODIGO_YA_VALORADO) return { tipo: "ya-valorada" };
  if (error.status === 429) {
    return { tipo: "error", mensaje: MENSAJE_DEMASIADOS_INTENTOS };
  }
  if (error.status === 409 || error.status === 410) {
    return { tipo: "error", mensaje: error.message };
  }
  return { tipo: "error", mensaje: MENSAJE_ERROR_VALORACION };
}
