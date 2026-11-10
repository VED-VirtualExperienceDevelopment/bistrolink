/**
 * BL-518: aviso de que el mozo cerró la mesa.
 *
 * La carta del comensal sigue la sesión de su mesa por WebSocket
 * (`mesa:seguir`). Cuando el mozo la cierra, el backend emite
 * `mesa:sesion_cerrada` y la pantalla pasa a «Tu mesa se cerró» sin
 * recargar. Lógica pura, probada en test/unitarios/sesion-mesa.utils.spec.ts.
 */

export const EVENTO_SEGUIR_MESA = "mesa:seguir";
export const EVENTO_SESION_CERRADA = "mesa:sesion_cerrada";

export const TITULO_MESA_CERRADA = "Tu mesa se cerró";
export const DETALLE_MESA_CERRADA =
  "¡Gracias por tu visita! Para volver a pedir, pedile al mozo que abra la mesa y escaneá el QR de nuevo.";

/** Lo que manda el backend en `mesa:sesion_cerrada`. */
export interface AvisoSesionCerrada {
  sesionMesa?: unknown;
}

/**
 * El aviso es para esta pantalla si es de su sesión. Un aviso sin sesión
 * (por ejemplo, el QR ya no sirve) también la cierra: no puede seguir
 * pidiendo con ese QR.
 */
export function esCierreDeEstaSesion(
  aviso: AvisoSesionCerrada | null | undefined,
  sesionMesa: string,
): boolean {
  if (!aviso || typeof aviso.sesionMesa !== "string") return true;
  return aviso.sesionMesa === sesionMesa;
}
