import type { TipoElementoPlano } from "@/types/plano";

/**
 * HU-028 (BL-173): nombre e ícono de cada elemento fijo del plano.
 *
 * - `icono`: nombre del Material Symbol, para los botones de la barra (HTML,
 *   misma fuente que el resto del admin).
 * - `trazo`: el mismo ícono como trazo SVG (viewBox 24x24) para dibujarlo en
 *   el lienzo con un Path de Konva. El canvas no puede usar la fuente de
 *   íconos de forma confiable (si todavía no cargó, dibujaría el texto
 *   "door_front"), así que se copia el trazo del ícono.
 *
 * Trazos tomados de Material Design Icons (Google), variante "outlined",
 * licencia Apache-2.0.
 */
export const ICONO_POR_ELEMENTO: Record<
  TipoElementoPlano,
  { etiqueta: string; icono: string; trazo: string }
> = {
  PUERTA: {
    etiqueta: "Puerta",
    icono: "door_front",
    trazo:
      "M19 19V5c0-1.1-.9-2-2-2H7c-1.1 0-2 .9-2 2v14H3v2h18v-2h-2zm-2 0H7V5h10v14zm-4-8h2v2h-2v-2z",
  },
  BANO: {
    etiqueta: "Baño",
    icono: "wc",
    trazo:
      "M5.5 22v-7.5H4V9c0-1.1.9-2 2-2h3c1.1 0 2 .9 2 2v5.5H9.5V22h-4zM18 22v-6h3l-2.54-7.63A2.01 2.01 0 0 0 16.56 7h-.12a2 2 0 0 0-1.9 1.37L12 16h3v6h3zM7.5 6c1.11 0 2-.89 2-2s-.89-2-2-2-2 .89-2 2 .89 2 2 2zm9 0c1.11 0 2-.89 2-2s-.89-2-2-2-2 .89-2 2 .89 2 2 2z",
  },
  COCINA: {
    etiqueta: "Cocina",
    icono: "soup_kitchen",
    trazo:
      "M6.4 7c-.34.55-.4.97-.4 1.38C6 9.15 7 11 7 12c0 .95-.4 1.5-.4 1.5H5.1s.4-.55.4-1.5c0-1-1-2.85-1-3.62 0-.41.06-.83.4-1.38h1.5zm5 0c-.34.55-.4.97-.4 1.38 0 .77 1 2.62 1 3.62 0 .95-.4 1.5-.4 1.5h1.5s.4-.55.4-1.5c0-1-1-2.85-1-3.62 0-.41.06-.83.4-1.38h-1.5zM8.15 7c-.34.55-.4.97-.4 1.38 0 .77 1 2.63 1 3.62 0 .95-.4 1.5-.4 1.5h1.5s.4-.55.4-1.5c0-1-1-2.85-1-3.62 0-.41.06-.83.4-1.38h-1.5zM18.6 2c-1.54 0-2.81 1.16-2.98 2.65L14.53 15H4.01c-.6 0-1.09.53-1 1.13C3.53 19.46 6.39 22 9.75 22c3.48 0 6.34-2.73 6.71-6.23L17.61 4.9c.05-.51.47-.9.99-.9.55 0 1 .45 1 1 0 .3-.1 1.25-.1 1.25l1.97.25s.13-1.06.13-1.5c0-1.65-1.35-3-3-3zM9.75 20c-1.94 0-3.67-1.23-4.43-3h8.79c-.72 1.78-2.42 3-4.36 3z",
  },
  CAJA: {
    etiqueta: "Caja",
    icono: "point_of_sale",
    trazo:
      "M17 2H7c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 4H7V4h10v2zm3 16H4c-1.1 0-2-.9-2-2v-1h20v1c0 1.1-.9 2-2 2zm-1.47-11.81A2.008 2.008 0 0 0 16.7 9H7.3c-.79 0-1.51.47-1.83 1.19L2 18h20l-3.47-7.81zM9.5 16h-1c-.28 0-.5-.22-.5-.5s.22-.5.5-.5h1c.28 0 .5.22.5.5s-.22.5-.5.5zm0-2h-1c-.28 0-.5-.22-.5-.5s.22-.5.5-.5h1c.28 0 .5.22.5.5s-.22.5-.5.5zm0-2h-1c-.28 0-.5-.22-.5-.5s.22-.5.5-.5h1c.28 0 .5.22.5.5s-.22.5-.5.5zm3 4h-1c-.28 0-.5-.22-.5-.5s.22-.5.5-.5h1c.28 0 .5.22.5.5s-.22.5-.5.5zm0-2h-1c-.28 0-.5-.22-.5-.5s.22-.5.5-.5h1c.28 0 .5.22.5.5s-.22.5-.5.5zm0-2h-1c-.28 0-.5-.22-.5-.5s.22-.5.5-.5h1c.28 0 .5.22.5.5s-.22.5-.5.5zm3 4h-1c-.28 0-.5-.22-.5-.5s.22-.5.5-.5h1c.28 0 .5.22.5.5s-.22.5-.5.5zm0-2h-1c-.28 0-.5-.22-.5-.5s.22-.5.5-.5h1c.28 0 .5.22.5.5s-.22.5-.5.5zm0-2h-1c-.28 0-.5-.22-.5-.5s.22-.5.5-.5h1c.28 0 .5.22.5.5s-.22.5-.5.5z",
  },
  BARRA: {
    etiqueta: "Barra",
    icono: "local_bar",
    trazo:
      "M14.77 9 12 12.11 9.23 9h5.54M21 3H3v2l8 9v5H6v2h12v-2h-5v-5l8-9V3zM7.43 7 5.66 5h12.69l-1.78 2H7.43z",
  },
};
