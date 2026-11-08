/**
 * BL-195 / BL-257: qué imagen mostrar para un ítem del menú.
 *
 * Lógica pura (sin React) para poder testearla igual que el resto de los
 * utils del frontend. La usan el menú público y el admin a través de
 * <ItemImagen />.
 */

/** Placeholder local (apps/frontend/public/placeholder-item.svg). */
export const PLACEHOLDER_ITEM = '/placeholder-item.svg';

/**
 * Devuelve el `src` a usar para la imagen de un ítem.
 *
 * - Sin URL (el ítem no tiene imagen, o el backend no pudo firmarla y
 *   devolvió null): placeholder, sin pedir nada a S3 ni al optimizador.
 * - La imagen ya falló al cargar (404 en S3, URL vencida, etc.): placeholder.
 * - Si no: la URL firmada tal cual.
 */
export function srcImagenItem(
  url: string | null | undefined,
  fallo: boolean,
): string {
  if (fallo || !url?.trim()) {
    return PLACEHOLDER_ITEM;
  }
  return url;
}

/** true si el src resuelto es el placeholder (para no reintentar onError en bucle). */
export function esPlaceholder(src: string): boolean {
  return src === PLACEHOLDER_ITEM;
}
