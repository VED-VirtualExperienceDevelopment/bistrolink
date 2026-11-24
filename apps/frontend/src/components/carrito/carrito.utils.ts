import { sumarUnidad } from "@/components/menu-digital.utils";
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

/**
 * BL-378: una unidad más de un plato del carrito, sin pasar del tope de
 * BL-425 (sumarUnidad). Si el plato no está, el carrito no cambia: se
 * agrega desde la carta.
 */
export function conUnaMas<T extends LineaConCantidad>(
  lineas: readonly T[],
  itemCartaId: string,
): T[] {
  return lineas.map((l) =>
    l.itemCartaId === itemCartaId
      ? { ...l, cantidad: sumarUnidad(l.cantidad) }
      : l,
  );
}

/** BL-378: una unidad menos; con la última, el plato sale del pedido. */
export function conUnaMenos<T extends LineaConCantidad>(
  lineas: readonly T[],
  itemCartaId: string,
): T[] {
  return lineas.flatMap((l) => {
    if (l.itemCartaId !== itemCartaId) return [l];
    return l.cantidad > 1 ? [{ ...l, cantidad: l.cantidad - 1 }] : [];
  });
}

/** BL-378: saca el plato del pedido, con todas sus unidades y su nota. */
export function sinLinea<T extends LineaConCantidad>(
  lineas: readonly T[],
  itemCartaId: string,
): T[] {
  return lineas.filter((l) => l.itemCartaId !== itemCartaId);
}

/** BL-378: qué cambió en el carrito, para anunciarlo al lector de pantalla. */
export type CambioCarrito = {
  readonly tipo: "agregado" | "restado" | "quitado";
  readonly nombre: string;
};

/**
 * Lo que anuncia el lector de pantalla después de un cambio en el carrito:
 * qué pasó y cómo quedó el pedido (el total cambia en cada cambio, así el
 * texto no se repite igual).
 */
export function anuncioDelCarrito(
  cambio: CambioCarrito,
  cantidadTotal: number,
  total: number,
): string {
  if (cambio.tipo === "agregado") {
    return anuncioAgregado(cambio.nombre, cantidadTotal, total);
  }
  const que =
    cambio.tipo === "restado"
      ? `Quitaste una unidad de ${cambio.nombre}.`
      : `Quitaste ${cambio.nombre} del pedido.`;
  if (cantidadTotal === 0) return `${que} Tu pedido quedó vacío.`;
  return `${que} Tu pedido: ${textoItems(cantidadTotal)}, ${formatearPrecio(total)}.`;
}

/** Nombres accesibles de los botones de cada plato del detalle. */
export function etiquetasDeLinea(nombre: string) {
  return {
    restar: `Quitar uno de ${nombre}`,
    sumar: `Agregar uno de ${nombre}`,
    quitar: `Quitar ${nombre} del pedido`,
  };
}
