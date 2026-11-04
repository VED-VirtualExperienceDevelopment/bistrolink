/**
 * HU-015 (BL-120): lógica pura de la campana de stock y del stock de la
 * jornada (probada en test/unitarios/stock.utils.spec.ts).
 */

export type TipoAlertaStock = "STOCK_CRITICO" | "AGOTADO";

/** GET /admin/stock/alertas y el evento `stock:alerta`. */
export interface AlertaStock {
  itemId: string;
  nombre: string;
  stockActual: number;
  umbralAlerta: number;
  tipo: TipoAlertaStock;
  /** Solo en el evento: unidades vendidas sin stock (ADR 0009). */
  vendidoSinStock?: number;
}

export const ETIQUETA_TIPO: Record<TipoAlertaStock, string> = {
  STOCK_CRITICO: "Por agotarse",
  AGOTADO: "Agotado",
};

/** Nombre accesible del botón de la campana. */
export function etiquetaCampana(alertas: readonly AlertaStock[]): string {
  const n = alertas.length;
  if (n === 0) return "Notificaciones de stock: sin ítems críticos";
  return `Notificaciones de stock: ${n} ${n === 1 ? "ítem crítico" : "ítems críticos"}`;
}

/** Rojo si hay algún agotado, ámbar si solo hay por agotarse. */
export function colorBadge(
  alertas: readonly AlertaStock[],
): "rojo" | "ambar" | null {
  if (alertas.length === 0) return null;
  return alertas.some((a) => a.tipo === "AGOTADO") ? "rojo" : "ambar";
}

export function textoBadge(cantidad: number): string {
  return cantidad > 9 ? "9+" : String(cantidad);
}

/** «Quedan 3 · aviso en 5» o «Sin unidades · aviso en 5». */
export function textoUnidades(alerta: AlertaStock): string {
  const quedan =
    alerta.stockActual > 0 ? `Quedan ${alerta.stockActual}` : "Sin unidades";
  return `${quedan} · aviso en ${alerta.umbralAlerta}`;
}

/** «1 vendida sin stock», «2 vendidas sin stock». */
export function textoSinStock(unidades: number): string {
  return `${unidades} ${unidades === 1 ? "vendida" : "vendidas"} sin stock`;
}

/**
 * Lo que anuncia el lector de pantalla cuando llega una alerta en vivo:
 * solo lo nuevo o lo que empeoró (pasó a agotado o se vendió sin stock).
 */
export function anuncioAlerta(
  previas: readonly AlertaStock[],
  alerta: AlertaStock,
): string {
  const previa = previas.find((a) => a.itemId === alerta.itemId);
  if (alerta.vendidoSinStock) {
    return `Stock: ${alerta.nombre}, ${textoSinStock(alerta.vendidoSinStock)}`;
  }
  if (previa?.tipo === alerta.tipo) return "";
  return alerta.tipo === "AGOTADO"
    ? `Stock: ${alerta.nombre} se agotó`
    : `Stock: ${alerta.nombre} por agotarse, quedan ${alerta.stockActual}`;
}

/**
 * Ventas sin stock que avisó el servidor en vivo (no vienen en la lista):
 * se suman por ítem y se olvidan cuando el ítem sale de las alertas.
 */
export function acumularSinStock(
  actuales: Readonly<Record<string, number>>,
  alerta: AlertaStock,
): Record<string, number> {
  if (!alerta.vendidoSinStock) return { ...actuales };
  return {
    ...actuales,
    [alerta.itemId]: (actuales[alerta.itemId] ?? 0) + alerta.vendidoSinStock,
  };
}

export function sinStockVigentes(
  sinStock: Readonly<Record<string, number>>,
  alertas: readonly AlertaStock[],
): Record<string, number> {
  const ids = new Set(alertas.map((a) => a.itemId));
  return Object.fromEntries(
    Object.entries(sinStock).filter(([itemId]) => ids.has(itemId)),
  );
}

/** Movimiento con el teclado dentro del menú de la campana. */
export function siguienteIndice(
  actual: number,
  total: number,
  tecla: string,
): number | null {
  if (total === 0) return null;
  switch (tecla) {
    case "ArrowDown":
      return (actual + 1) % total;
    case "ArrowUp":
      return (actual - 1 + total) % total;
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return null;
  }
}

/** Tope de unidades (el mismo que valida la API). */
export const MAXIMO_UNIDADES_STOCK = 100_000;

/**
 * Valida las unidades tipeadas en «Reponer stock»: un entero de 0 al tope.
 * Devuelve el número o el mensaje de error.
 */
export function leerUnidades(
  texto: string,
): { ok: true; valor: number } | { ok: false; error: string } {
  const limpio = texto.trim();
  if (limpio === "") return { ok: false, error: "Ingresá las unidades." };
  if (!/^\d+$/.test(limpio)) {
    return { ok: false, error: "Usá un número entero, sin decimales." };
  }
  const valor = Number(limpio);
  if (valor > MAXIMO_UNIDADES_STOCK) {
    return {
      ok: false,
      error: `El máximo es ${MAXIMO_UNIDADES_STOCK.toLocaleString("es-UY")}.`,
    };
  }
  return { ok: true, valor };
}
