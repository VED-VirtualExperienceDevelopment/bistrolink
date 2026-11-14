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
  /** Color de acento: etiquetas y destacados. */
  colorAcento: string;
}

export const PLANTILLAS_MARCA: readonly DefinicionPlantilla[] = [
  {
    codigo: "clasica",
    nombre: "Clásica",
    paraQuien: "Para cualquier local, con los colores de BistroLink.",
    colorMarca: "#6e54ad",
    colorAcento: "#755b00",
  },
  {
    codigo: "gourmet",
    nombre: "Gourmet",
    paraQuien: "Para restaurantes con servicio a la mesa y cocina de autor.",
    colorMarca: "#5c1a2b",
    colorAcento: "#7a5a00",
  },
  {
    codigo: "rapida",
    nombre: "Comida rápida",
    paraQuien: "Para hamburgueserías, pizzerías y locales al paso.",
    colorMarca: "#b3261e",
    colorAcento: "#8a4b00",
  },
  {
    codigo: "familiar",
    nombre: "Familiar",
    paraQuien: "Para parrillas, bodegones y locales para ir en familia.",
    colorMarca: "#2e6b3f",
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
