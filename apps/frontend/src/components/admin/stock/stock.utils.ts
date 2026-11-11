/**
 * HU-015 (BL-120): lógica pura de las alertas de stock y del stock de la
 * jornada (probada en test/unitarios/stock.utils.spec.ts). BL-470: las
 * alertas de stock se muestran en la campana de Alertas (ver
 * components/alertas).
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

/**
 * BL-474: colores del estado de un ítem, con los tokens del tema (antes
 * `amber-*`, fuera de la paleta). Los usan la tabla de «Stock de la
 * jornada» y la campana. Contraste: on-tertiary-fixed sobre tertiary-fixed
 * ≈ 13:1; on-error-container sobre error-container ≈ 7:1.
 */
export const CLASE_ESTADO_STOCK: Record<TipoAlertaStock, string> = {
  STOCK_CRITICO: "bg-tertiary-fixed text-on-tertiary-fixed",
  AGOTADO: "bg-error-container text-on-error-container",
};

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
