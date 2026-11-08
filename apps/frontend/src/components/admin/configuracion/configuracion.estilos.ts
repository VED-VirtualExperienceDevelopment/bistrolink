/**
 * Clases de la pantalla de Configuración (HU-020), compartidas con sus
 * secciones y con «Anonimizar datos de facturación».
 *
 * BL-473 (WCAG 2.1 AA):
 * - Bordes de los campos con `outline` (contraste 4,6:1 sobre blanco; 1.4.11
 *   pide 3:1). `outline-variant` (1,6:1) queda solo para bordes decorativos
 *   de las tarjetas.
 * - Foco visible sólido (`ring-2 ring-primary`), no al 20 %.
 * - Controles y botones con alto mínimo de 48 px (`min-h-12`).
 * - `scroll-mb-28` en los controles: al recibir el foco (por ejemplo, el
 *   primer campo con error) quedan por encima de la barra de «Guardar
 *   cambios», que está fija abajo.
 */
const FOCO =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

const CONTROL_BASE =
  "min-h-12 w-full min-w-0 scroll-mb-28 rounded-lg border border-outline px-3 text-body-md focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary aria-[invalid=true]:border-error";

export const CLASE_CONTROL = `${CONTROL_BASE} bg-surface-container-lowest text-on-surface`;
/** Campo de solo lectura (RUT): fondo gris, sin competir con los editables. */
export const CLASE_CONTROL_SOLO_LECTURA = `${CONTROL_BASE} bg-surface-container text-on-surface-variant`;
export const CLASE_ETIQUETA =
  "mb-1 block text-label-md text-on-surface-variant";
export const CLASE_TARJETA =
  "min-w-0 space-y-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 md:p-6";
export const CLASE_TITULO_TARJETA = "text-headline-sm text-on-surface";
export const CLASE_AYUDA = "text-body-sm text-on-surface-variant";
export const CLASE_ERROR_CAMPO = "mt-1 text-body-sm text-error";
export const CLASE_ERROR_GENERAL =
  "rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container";
export const CLASE_PROXIMAMENTE =
  "rounded-full bg-surface-container-high px-2 py-0.5 text-label-sm text-on-surface-variant";
export const CLASE_BOTON = `flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-body-md font-medium text-on-primary hover:opacity-90 ${FOCO} focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50`;
export const CLASE_BOTON_SECUNDARIO = `flex min-h-12 items-center justify-center rounded-lg border border-outline px-4 text-body-md text-primary hover:bg-surface-container-high ${FOCO} focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50`;
export const CLASE_BOTON_PELIGRO = `flex min-h-12 items-center justify-center rounded-lg bg-error px-4 text-body-md font-medium text-on-error hover:opacity-90 ${FOCO} focus-visible:outline-error disabled:cursor-not-allowed disabled:opacity-50`;
/** Fila de una opción (radio): toda la fila es clicable, 48 px de alto. */
export const CLASE_FILA_OPCION =
  "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-surface-container-low has-[:disabled]:cursor-not-allowed has-[:disabled]:hover:bg-transparent";
export const CLASE_RADIO = `h-5 w-5 shrink-0 scroll-mb-28 accent-primary ${FOCO} focus-visible:outline-primary`;
