/**
 * HU-043 (BL-531): plantillas de marca del local (fase 1 de la marca propia).
 *
 * El Administrador elige una por tipo de local y la carta del comensal toma
 * sus colores. La API solo guarda el nombre: los colores viven en el
 * frontend (plantillas-marca.ts), que ya los controla con contraste AA sobre
 * blanco. Así no se guardan colores libres que puedan dejar la carta
 * ilegible.
 *
 * La base tiene el mismo control (CHECK restaurante_plantilla_valida). Para
 * sumar una plantilla hay que agregarla acá, en el CHECK (migración nueva) y
 * en el frontend.
 */
export const PLANTILLAS_MARCA = [
  'clasica',
  'gourmet',
  'rapida',
  'familiar',
] as const;

export type PlantillaMarca = (typeof PLANTILLAS_MARCA)[number];

/** La de los locales que no eligieron ninguna (default de la columna). */
export const PLANTILLA_POR_DEFECTO: PlantillaMarca = 'clasica';
