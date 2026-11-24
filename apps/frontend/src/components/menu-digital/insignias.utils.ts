/**
 * HU-044 (BL-537): qué insignias lleva un plato en el menú del comensal.
 * Lógica pura, probada en test/unitarios/insignias.utils.spec.ts. HU-045
 * («Más pedido», BL-548) suma la suya.
 */
export type VarianteInsignia = "sugerencia" | "masPedido";

export interface PlatoConInsignias {
  readonly disponible: boolean;
  readonly destacado?: boolean;
  /** HU-045 (BL-548): lo calcula la API con las ventas reales. */
  readonly masPedido?: boolean;
}

/**
 * HU-045 (BL-548): de dónde sale «Más pedido», para el lector de pantalla y
 * el `title` (transparencia, Anexo 13).
 */
export const EXPLICACION_MAS_PEDIDO =
  "Entre los 3 platos más pedidos del local en los últimos 30 días";

/**
 * Insignias en el orden en que se muestran. Un plato agotado no lleva
 * ninguna: se ve solo «No disponible», y cuando vuelve a haber stock la
 * insignia aparece sola.
 */
export function insigniasDelPlato(
  plato: PlatoConInsignias,
): VarianteInsignia[] {
  if (!plato.disponible) return [];
  const insignias: VarianteInsignia[] = [];
  // Primero la que eligió el local, después la de las ventas.
  if (plato.destacado) insignias.push("sugerencia");
  if (plato.masPedido) insignias.push("masPedido");
  return insignias;
}
