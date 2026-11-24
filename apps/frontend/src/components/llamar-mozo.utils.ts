/**
 * BL-592: lógica pura de «Llamar al mozo» (estados y textos), separada del
 * componente para poder testearla (test/unitarios/llamar-mozo.utils.spec.ts).
 *
 * El backend acepta un llamado por minuto por mesa (BL-70,
 * @Throttle en POST /mesas/llamar) y responde 429 si se repite antes.
 * Ese minuto es un límite interno: al comensal no se le muestra ningún
 * tiempo (se leería como lo que tarda el mozo en llegar). Pasado el minuto,
 * el botón ofrece «Volver a llamar».
 */

/** Mismo límite que el backend: 1 llamado por minuto por mesa. */
export const LIMITE_LLAMADO_MS = 60_000;

export type EstadoLlamado =
  | 'listo'
  | 'enviando'
  | 'avisado'
  | 'esperando'
  | 'error';

/**
 * Hasta cuándo dura el límite después de un 429. Usa el header Retry-After
 * (en segundos) si llega y es válido; si no, el límite completo.
 */
export function hastaDespuesDe429(
  retryAfter: string | null,
  ahora: number,
): number {
  const segundos = Number(retryAfter);
  if (retryAfter && Number.isFinite(segundos) && segundos > 0) {
    return ahora + Math.min(segundos * 1000, LIMITE_LLAMADO_MS);
  }
  return ahora + LIMITE_LLAMADO_MS;
}

/** El botón no hace nada mientras se envía o mientras corre el límite. */
export function botonDeshabilitado(estado: EstadoLlamado): boolean {
  return estado === 'enviando' || estado === 'avisado' || estado === 'esperando';
}

/**
 * Solo el error se muestra en pantalla, debajo de la barra: el botón dice
 * «Reintentar» y el mensaje explica qué pasó. En «avisado» la confirmación
 * ya está en el propio botón (✓ «Mozo avisado»), así que el aviso va solo
 * para el lector de pantalla y no ocupa lugar en la carta.
 */
export function anuncioVisible(estado: EstadoLlamado): boolean {
  return estado === 'error';
}

/**
 * Texto del botón. `etiqueta` es el nombre accesible y siempre contiene el
 * texto `visible` (WCAG 2.5.3).
 *
 * `yaLlamo`: el comensal ya llamó una vez en esta pantalla; pasado el
 * límite, el botón dice «Volver a llamar» para que pueda insistir si el
 * mozo se demora.
 *
 * `compacto`: barra superior en pantallas chicas (menos de 380 px)
 * (BL-592, CA 3).
 */
export function textoBoton(
  estado: EstadoLlamado,
  yaLlamo: boolean,
  compacto = false,
): { etiqueta: string; visible: string } {
  switch (estado) {
    case 'listo':
      if (yaLlamo) {
        return {
          etiqueta: 'Volver a llamar al mozo',
          visible: compacto ? 'Mozo' : 'Volver a llamar',
        };
      }
      return {
        etiqueta: 'Llamar al mozo',
        visible: compacto ? 'Mozo' : 'Llamar al mozo',
      };
    case 'enviando':
      return { etiqueta: 'Avisando…', visible: 'Avisando…' };
    case 'avisado':
    case 'esperando':
      return {
        etiqueta: 'Mozo avisado',
        visible: compacto ? 'Avisado' : 'Mozo avisado',
      };
    case 'error':
      return { etiqueta: 'Reintentar', visible: 'Reintentar' };
  }
}

export const MENSAJE_AVISADO = 'Listo, avisamos al mozo.';
export const MENSAJE_YA_AVISADO = 'Ya avisamos al mozo.';
export const MENSAJE_ERROR_LLAMADO = 'No pudimos avisarle al mozo. Probá de nuevo.';

/**
 * Lo que anuncia el lector de pantalla al cambiar de estado (y, en «error»,
 * lo que se ve debajo de la barra; ver anuncioVisible). Null: nada que
 * anunciar. En «error», el mensaje del backend si lo hay. Ninguno menciona
 * tiempos: el sistema no sabe cuándo llega el mozo.
 */
export function anuncioDelEstado(
  estado: EstadoLlamado,
  mensajeError?: string | null,
): string | null {
  switch (estado) {
    case 'avisado':
      return MENSAJE_AVISADO;
    case 'esperando':
      return MENSAJE_YA_AVISADO;
    case 'error':
      return mensajeError ?? MENSAJE_ERROR_LLAMADO;
    default:
      return null;
  }
}
