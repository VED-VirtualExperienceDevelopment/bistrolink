/** HU-012 (BL-108): clases compartidas del dashboard de reportes. */

export const CLASE_TARJETA =
  "rounded-xl border border-outline-variant bg-surface-container-lowest p-4 md:p-6";
export const CLASE_TITULO_TARJETA = "text-headline-sm text-on-surface";
export const CLASE_AYUDA = "text-body-sm text-on-surface-variant";
export const CLASE_FOCO =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
export const CLASE_BOTON_SECUNDARIO = `flex min-h-10 items-center gap-2 rounded-lg border border-outline-variant px-3 text-body-md text-on-surface hover:bg-surface-container-low disabled:opacity-50 ${CLASE_FOCO}`;
export const CLASE_ENLACE = `rounded text-body-sm text-primary underline-offset-2 hover:underline ${CLASE_FOCO}`;

/**
 * Chip de una opción (un radio escondido dentro de un label). El foco se ve
 * en el chip aunque el radio esté escondido.
 */
export function claseChip(elegido: boolean, deshabilitado = false): string {
  const base =
    "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-body-md transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary";
  if (deshabilitado) {
    return `${base} cursor-not-allowed border-outline-variant text-on-surface-variant opacity-70`;
  }
  return elegido
    ? `${base} border-primary bg-primary text-on-primary`
    : `${base} border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low`;
}
