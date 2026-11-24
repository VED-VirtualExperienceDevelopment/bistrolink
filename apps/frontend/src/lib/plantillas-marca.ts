import type { CSSProperties } from "react";
import type { PlantillaMarca } from "@/types/menu";

/**
 * HU-043 (BL-533 y BL-534): plantillas de marca del local.
 *
 * La API solo guarda el nombre (clasica, gourmet, rapida o familiar); los
 * colores viven acá. Los usan las tarjetas de Configuración y la carta del
 * comensal, así que lo que el Administrador ve al elegir es lo mismo que ve
 * el comensal.
 *
 * Contraste sobre blanco (WCAG 2.1 AA pide 4,5:1 para texto):
 * - Clásica: #6e54ad (5,94:1) y #755b00 (6,46:1).
 * - Gourmet: #5c1a2b (12,82:1) y #7a5a00 (6,38:1).
 * - Comida rápida: #b3261e (6,54:1) y #8a4b00 (6,80:1).
 * - Familiar: #2e6b3f (6,38:1) y #a0461b (6,20:1).
 *
 * Los dos colores sirven para texto sobre blanco y para texto blanco sobre
 * el color. Los colores de los estados (agotado, error, éxito) no cambian
 * con la plantilla. Para sumar una plantilla hay que agregarla también en la
 * API (PLANTILLAS_MARCA y el CHECK de la base).
 */
export interface DefinicionPlantilla {
  codigo: PlantillaMarca;
  nombre: string;
  /** Para qué tipo de local es, en una línea. */
  paraQuien: string;
  /** Color principal: encabezado, botones y precios. */
  colorMarca: string;
  /** El principal al pasar el mouse por un botón (un poco más oscuro). */
  colorHover: string;
  /** Color de acento: etiquetas y destacados. */
  colorAcento: string;
}

export const PLANTILLAS_MARCA: readonly DefinicionPlantilla[] = [
  {
    codigo: "clasica",
    nombre: "Clásica",
    paraQuien: "Para cualquier local, con los colores de BistroLink.",
    colorMarca: "#6e54ad",
    colorHover: "#5b468f",
    colorAcento: "#755b00",
  },
  {
    codigo: "gourmet",
    nombre: "Gourmet",
    paraQuien: "Para restaurantes con servicio a la mesa y cocina de autor.",
    colorMarca: "#5c1a2b",
    colorHover: "#46131f",
    colorAcento: "#7a5a00",
  },
  {
    codigo: "rapida",
    nombre: "Comida rápida",
    paraQuien: "Para hamburgueserías, pizzerías y locales al paso.",
    colorMarca: "#b3261e",
    colorHover: "#8f1e18",
    colorAcento: "#8a4b00",
  },
  {
    codigo: "familiar",
    nombre: "Familiar",
    paraQuien: "Para parrillas, bodegones y locales para ir en familia.",
    colorMarca: "#2e6b3f",
    colorHover: "#23532f",
    colorAcento: "#a0461b",
  },
];

export const PLANTILLA_POR_DEFECTO: PlantillaMarca = "clasica";

/**
 * La plantilla con ese código. Si no viene o no se conoce (una API anterior
 * o una plantilla nueva que este frontend todavía no tiene), la Clásica.
 */
export function plantillaPorCodigo(
  codigo?: string | null,
): DefinicionPlantilla {
  return (
    PLANTILLAS_MARCA.find((plantilla) => plantilla.codigo === codigo) ??
    PLANTILLAS_MARCA[0]
  );
}

/** "#6e54ad" → "110 84 173": el formato de las variables de globals.css. */
export function canalesRgb(hex: string): string {
  return [1, 3, 5]
    .map((inicio) => Number.parseInt(hex.slice(inicio, inicio + 2), 16))
    .join(" ");
}

/**
 * HU-043 (BL-534): variables CSS de la marca para el contenedor del menú
 * (style). Con la Clásica, o sin plantilla, no define nada: quedan las de
 * globals.css y el menú se ve exactamente igual que antes.
 */
export function variablesDeMarca(codigo?: string | null): CSSProperties {
  const plantilla = plantillaPorCodigo(codigo);
  if (plantilla.codigo === PLANTILLA_POR_DEFECTO) return {};
  return {
    "--brand-primary": canalesRgb(plantilla.colorMarca),
    "--brand-primary-hover": canalesRgb(plantilla.colorHover),
    "--brand-accent": canalesRgb(plantilla.colorAcento),
  } as CSSProperties;
}
