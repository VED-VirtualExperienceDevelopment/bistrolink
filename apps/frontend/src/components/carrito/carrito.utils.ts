import { formatearPrecio } from "@/components/pago/pago.utils";

/**
 * BL-519: desde este ancho (lg de Tailwind) el carrito es la columna de la
 * derecha; por debajo, una barra fija de una línea que abre una hoja con el
 * detalle.
 */
export const CONSULTA_PANTALLA_ANCHA = "(min-width: 1024px)";

/** Id del título del carrito: lo usa la hoja (aria-labelledby). */
export const ID_TITULO_CARRITO = "titulo-carrito";

type LineaConCantidad = {
  readonly itemCartaId: string;
  readonly cantidad: number;
};

/** «1 ítem» / «3 ítems». */
export function textoItems(cantidad: number): string {
  return `${cantidad} ${cantidad === 1 ? "ítem" : "ítems"}`;
}

/** Unidades de un plato que ya están en el carrito (0 si no está). */
export function cantidadEnCarrito(
  carrito: readonly LineaConCantidad[],
  itemCartaId: string,
): number {
  return carrito.find((l) => l.itemCartaId === itemCartaId)?.cantidad ?? 0;
}

/**
 * Lo que anuncia el lector de pantalla al agregar un plato: en el celular el
 * detalle del carrito no se ve, así que se dice qué se agregó y cómo quedó
 * el pedido. La cantidad cambia en cada agregado, así el anuncio no se
 * repite igual (un texto idéntico no se vuelve a leer).
 */
export function anuncioAgregado(
  nombre: string,
  cantidadTotal: number,
  total: number,
): string {
  return `Agregaste ${nombre}. Tu pedido: ${textoItems(cantidadTotal)}, ${formatearPrecio(total)}.`;
}
