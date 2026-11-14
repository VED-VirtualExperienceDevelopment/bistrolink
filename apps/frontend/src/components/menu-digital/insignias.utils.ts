/**
 * HU-044 (BL-537): qué insignias lleva un plato en el menú del comensal.
 * Lógica pura, probada en test/unitarios/insignias.utils.spec.ts. HU-045
 * («Más pedido», BL-548) suma su variante acá.
 */
export type VarianteInsignia = "sugerencia";

export interface PlatoConInsignias {
  readonly disponible: boolean;
  readonly destacado?: boolean;
}

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
  if (plato.destacado) insignias.push("sugerencia");
  return insignias;
}
