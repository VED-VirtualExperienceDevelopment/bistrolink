/**
 * HU-015 (BL-120): reglas del stock de un ítem de la carta, sin acceso a la
 * base (probadas en test/unitarios/estado-stock.spec.ts).
 */

export type TipoAlertaStock = 'STOCK_CRITICO' | 'AGOTADO';

export interface StockDeItem {
  controlaStock: boolean;
  stockActual: number;
  umbralAlerta: number;
}

/**
 * La alerta de un ítem, o null si no tiene. Solo con control de stock:
 * agotado en 0, «por agotarse» en o debajo del umbral (D4).
 */
export function tipoAlerta(item: StockDeItem): TipoAlertaStock | null {
  if (!item.controlaStock) return null;
  if (item.stockActual <= 0) return 'AGOTADO';
  if (item.stockActual <= item.umbralAlerta) return 'STOCK_CRITICO';
  return null;
}

/**
 * Disponibilidad del ítem después de que el administrador ajusta su stock.
 * Con control de stock, la disponibilidad sigue al stock: en 0 no se puede
 * pedir y al reponer vuelve a la carta (D6). Sin control de stock, queda
 * como estaba (la maneja el switch de la carta).
 */
export function disponibleTrasAjuste(
  item: StockDeItem,
  disponibleActual: boolean,
): boolean {
  if (!item.controlaStock) return disponibleActual;
  return item.stockActual > 0;
}

/** Orden de la campana: los agotados primero, después los de menos stock. */
export function compararAlertas(
  a: { tipo: TipoAlertaStock; stockActual: number; nombre: string },
  b: { tipo: TipoAlertaStock; stockActual: number; nombre: string },
): number {
  if (a.tipo !== b.tipo) return a.tipo === 'AGOTADO' ? -1 : 1;
  return a.stockActual - b.stockActual || a.nombre.localeCompare(b.nombre);
}

/** Las cantidades pedidas de cada ítem (un ítem puede venir en varias líneas). */
export function cantidadesPorItem(
  lineas: readonly { itemCartaId: string; cantidad: number }[],
): Map<string, number> {
  const cantidades = new Map<string, number>();
  for (const { itemCartaId, cantidad } of lineas) {
    cantidades.set(itemCartaId, (cantidades.get(itemCartaId) ?? 0) + cantidad);
  }
  return cantidades;
}

/**
 * El mensaje del 409 si el stock no alcanza para lo pedido, o null si
 * alcanza (o el ítem no controla stock). D3: se verifica antes de cobrar.
 */
export function faltaStock(
  item: StockDeItem & { nombre: string },
  cantidad: number,
): string | null {
  if (!item.controlaStock || item.stockActual >= cantidad) return null;
  return item.stockActual > 0
    ? `No hay stock suficiente de "${item.nombre}": quedan ${item.stockActual}`
    : `"${item.nombre}" está agotado`;
}
