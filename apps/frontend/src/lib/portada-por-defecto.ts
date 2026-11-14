/**
 * HU-043 (BL-562): portada por defecto del banner de la carta, la de los
 * locales que no subieron la suya. La usan la carta (MenuDigital) y la
 * vista previa de Configuración.
 *
 * BL-450: varios tamaños para que el navegador baje el que necesita
 * (Unsplash redimensiona por URL) y el LCP en el celular no se dispare.
 */
const BASE =
  "https://images.unsplash.com/photo-1514933651103-005eec06c04b?q=60&auto=format&fit=crop";

const url = (ancho: number) => `${BASE}&w=${ancho}`;

export const PORTADA_POR_DEFECTO = {
  src: url(828),
  srcSet: [640, 828, 1200, 1600]
    .map((ancho) => `${url(ancho)} ${ancho}w`)
    .join(", "),
} as const;
