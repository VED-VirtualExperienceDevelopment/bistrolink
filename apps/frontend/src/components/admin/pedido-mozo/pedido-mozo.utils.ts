/**
 * HU-039 (BL-209): el mozo carga el pedido de un comensal sin celular.
 * Lógica pura de /admin/mesas/pedido (probada en
 * test/unitarios/pedido-mozo.utils.spec.ts).
 */
import type { PedidoPendienteDeCobro } from "@/components/admin/cobros/cobros.utils";

/** Mismo tope que el carrito del comensal y el backend (BL-425). */
export const CANTIDAD_MAXIMA_POR_ITEM = 99;
/** Mismos topes que el DTO del pedido. */
export const LARGO_NOTA_ITEM = 300;
export const LARGO_NOTA_GENERAL = 500;

export const RUTA_CARTA_STAFF = "/admin/menu/categoria";
export const RUTA_PEDIDO_MOZO = "/pedidos/mozo";

/** GET /admin/menu/categoria (lo que se usa acá). */
export interface ItemCartaStaff {
  id: string;
  nombre: string;
  descripcion?: string | null;
  /** Decimal: llega como texto («590») o número. */
  precio: string | number;
  disponible: boolean;
}

export interface CategoriaCartaStaff {
  id: string;
  nombre: string;
  activo?: boolean;
  items: ItemCartaStaff[];
}

/** Lo que el mozo eligió: cantidad y nota por ítem. */
export type Carrito = Record<string, { cantidad: number; observacion: string }>;

/** Respuesta de POST /pedidos/mozo: la misma forma que «Cobros pendientes». */
export type PedidoCargado = PedidoPendienteDeCobro & { estado: string };

/** Ruta de la pantalla para una mesa del mapa. */
export function rutaCargarPedido(mesaId: string, numero: number): string {
  const parametros = new URLSearchParams({ mesa: mesaId, numero: String(numero) });
  return `/admin/mesas/pedido?${parametros.toString()}`;
}

/** Categorías activas con al menos un ítem; los ítems no disponibles se muestran deshabilitados. */
export function categoriasParaPedir(
  categorias: CategoriaCartaStaff[],
): CategoriaCartaStaff[] {
  return categorias.filter((c) => c.activo !== false && c.items.length > 0);
}

/** Suma o resta unidades, entre 0 y el tope. En 0, el ítem sale del carrito. */
export function cambiarCantidad(
  carrito: Carrito,
  itemId: string,
  delta: number,
): Carrito {
  const actual = carrito[itemId] ?? { cantidad: 0, observacion: "" };
  const cantidad = Math.min(
    CANTIDAD_MAXIMA_POR_ITEM,
    Math.max(0, actual.cantidad + delta),
  );
  const resto = { ...carrito };
  delete resto[itemId];
  return cantidad === 0 ? resto : { ...resto, [itemId]: { ...actual, cantidad } };
}

export function cambiarNota(
  carrito: Carrito,
  itemId: string,
  observacion: string,
): Carrito {
  const actual = carrito[itemId];
  if (!actual) return carrito;
  return {
    ...carrito,
    [itemId]: { ...actual, observacion: observacion.slice(0, LARGO_NOTA_ITEM) },
  };
}

export function cantidadDeItems(carrito: Carrito): number {
  return Object.values(carrito).reduce((acc, l) => acc + l.cantidad, 0);
}

/** Total en centésimos (sin errores de redondeo) y como texto con 2 decimales. */
export function totalDelCarrito(
  carrito: Carrito,
  categorias: CategoriaCartaStaff[],
): string {
  const precios = new Map(
    categorias.flatMap((c) => c.items).map((i) => [i.id, Number(i.precio)]),
  );
  const centesimos = Object.entries(carrito).reduce(
    (acc, [id, linea]) =>
      acc + Math.round((precios.get(id) ?? 0) * 100) * linea.cantidad,
    0,
  );
  return (centesimos / 100).toFixed(2);
}

/** Body de POST /pedidos/mozo. Las notas vacías no se mandan. */
export function armarPedido(
  mesaId: string,
  carrito: Carrito,
  notaGeneral: string,
  idempotencyKey: string,
) {
  const nota = notaGeneral.trim().slice(0, LARGO_NOTA_GENERAL);
  return {
    mesaId,
    idempotencyKey,
    items: Object.entries(carrito).map(([itemCartaId, linea]) => {
      const observacion = linea.observacion.trim();
      return observacion
        ? { itemCartaId, cantidad: linea.cantidad, observacion }
        : { itemCartaId, cantidad: linea.cantidad };
    }),
    ...(nota ? { observacionGeneral: nota } : {}),
  };
}

/**
 * Clave de idempotencia del pedido: una por carrito. Si el mozo toca dos
 * veces «Confirmar» o reintenta, se manda la misma (RNF.03).
 */
export function nuevaClaveDePedido(): string {
  return `mozo-${crypto.randomUUID()}`;
}
