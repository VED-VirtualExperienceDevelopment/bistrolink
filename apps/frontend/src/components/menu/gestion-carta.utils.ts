/**
 * BL-398 (BL-392): funciones puras de la pantalla Gestión de Carta. Están
 * fuera del componente para probarlas solas y para no anidar funciones
 * dentro de los efectos (regla de Sonar).
 */

export interface ItemGestion {
  readonly id: string;
  readonly nombre: string;
  readonly descripcion?: string;
  readonly precio: string;
  readonly disponible: boolean;
  readonly imagenKey?: string;
  readonly imagenUrl?: string | null;
  readonly categoriaId: string;
  readonly tieneHistorial?: boolean;
}

export interface CategoriaGestion {
  readonly id: string;
  readonly nombre: string;
  readonly descripcion?: string | null;
  readonly activo: boolean;
  readonly orden: number;
  readonly items: readonly ItemGestion[];
}

type Categorias = readonly CategoriaGestion[];

/** Cambia la disponibilidad de un ítem, esté en la categoría que esté. */
export function conDisponibilidad(
  categorias: Categorias,
  itemId: string,
  disponible: boolean,
): CategoriaGestion[] {
  return categorias.map((cat) => ({
    ...cat,
    items: cat.items.map((item) =>
      item.id === itemId ? { ...item, disponible } : item,
    ),
  }));
}

/** Cambia la visibilidad (`activo`) de una categoría. */
export function conVisibilidad(
  categorias: Categorias,
  categoriaId: string,
  activo: boolean,
): CategoriaGestion[] {
  return categorias.map((cat) =>
    cat.id === categoriaId ? { ...cat, activo } : cat,
  );
}

/** BL-394: saca un ítem archivado o eliminado de todas las categorías. */
export function sinItem(
  categorias: Categorias,
  itemId: string,
): CategoriaGestion[] {
  return categorias.map((cat) => ({
    ...cat,
    items: cat.items.filter((item) => item.id !== itemId),
  }));
}

/** BL-394: saca una categoría archivada o eliminada. */
export function sinCategoria(
  categorias: Categorias,
  categoriaId: string,
): CategoriaGestion[] {
  return categorias.filter((cat) => cat.id !== categoriaId);
}

function cantidad(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Contador del encabezado: «12 ítems · 2 agotados». Los agotados solo se
 * nombran si hay alguno.
 */
export function textoContadorCarta(categorias: Categorias): string {
  const items = categorias.flatMap((cat) => cat.items);
  const agotados = items.filter((item) => !item.disponible).length;
  const total = cantidad(items.length, "ítem", "ítems");
  return agotados > 0
    ? `${total} · ${cantidad(agotados, "agotado", "agotados")}`
    : total;
}

/** Contador de una categoría: «3 ítems». */
export function textoItemsDeCategoria(categoria: CategoriaGestion): string {
  return cantidad(categoria.items.length, "ítem", "ítems");
}
