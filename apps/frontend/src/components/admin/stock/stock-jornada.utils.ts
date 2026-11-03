/**
 * HU-015 (BL-120): lógica pura de la pantalla «Stock de la jornada»
 * (/admin/stock), probada en test/unitarios/stock-jornada.utils.spec.ts.
 */
import { leerUnidades, type TipoAlertaStock } from "./stock.utils";

/** Un ítem de GET /admin/stock (backend: ItemStock). */
export interface ItemStock {
  id: string;
  nombre: string;
  categoria: { id: string; nombre: string };
  disponible: boolean;
  controlaStock: boolean;
  stockActual: number;
  umbralAlerta: number;
  alerta: TipoAlertaStock | null;
}

/** Lo que el administrador está editando de un ítem (texto de los campos). */
export interface FilaStock {
  controlaStock: boolean;
  stock: string;
  umbral: string;
}

/** Filas por id de ítem. */
export type FormularioStock = Record<string, FilaStock>;

/** Un ítem del body de PATCH /admin/stock: solo lo que cambió. */
export interface AjusteStock {
  itemId: string;
  controlaStock?: boolean;
  stockActual?: number;
  umbralAlerta?: number;
}

export interface ErroresFila {
  stock?: string;
  umbral?: string;
}

export interface GrupoCategoria {
  categoria: { id: string; nombre: string };
  items: ItemStock[];
}

function filaDesde(item: ItemStock): FilaStock {
  return {
    controlaStock: item.controlaStock,
    stock: String(item.stockActual),
    umbral: String(item.umbralAlerta),
  };
}

export function formularioDesde(items: readonly ItemStock[]): FormularioStock {
  return Object.fromEntries(items.map((item) => [item.id, filaDesde(item)]));
}

/** Los ítems por categoría, en el orden en que llegan (el de la carta). */
export function agruparPorCategoria(
  items: readonly ItemStock[],
): GrupoCategoria[] {
  const grupos = new Map<string, GrupoCategoria>();
  for (const item of items) {
    const grupo = grupos.get(item.categoria.id);
    if (grupo) grupo.items.push(item);
    else
      grupos.set(item.categoria.id, {
        categoria: item.categoria,
        items: [item],
      });
  }
  return [...grupos.values()];
}

/**
 * Errores de una fila. Sin control de stock los campos están deshabilitados
 * y no se validan (tampoco se mandan).
 */
export function erroresDeFila(fila: FilaStock): ErroresFila {
  if (!fila.controlaStock) return {};
  const errores: ErroresFila = {};
  const stock = leerUnidades(fila.stock);
  if (!stock.ok) errores.stock = stock.error;
  const umbral = leerUnidades(fila.umbral);
  if (!umbral.ok) errores.umbral = umbral.error;
  return errores;
}

/** Solo las filas con algún error, por id de ítem. */
export function erroresDelFormulario(
  formulario: Readonly<FormularioStock>,
): Record<string, ErroresFila> {
  const errores: Record<string, ErroresFila> = {};
  for (const [id, fila] of Object.entries(formulario)) {
    const deFila = erroresDeFila(fila);
    if (deFila.stock || deFila.umbral) errores[id] = deFila;
  }
  return errores;
}

/**
 * El body de PATCH /admin/stock: por cada ítem, solo los campos que
 * cambiaron. Las filas con error se saltean (la pantalla no deja guardar
 * mientras haya alguna).
 */
export function ajustesParaGuardar(
  items: readonly ItemStock[],
  formulario: Readonly<FormularioStock>,
): AjusteStock[] {
  const ajustes: AjusteStock[] = [];
  for (const item of items) {
    const fila = formulario[item.id];
    if (!fila) continue;
    const ajuste: AjusteStock = { itemId: item.id };
    if (fila.controlaStock !== item.controlaStock) {
      ajuste.controlaStock = fila.controlaStock;
    }
    if (fila.controlaStock) {
      const stock = leerUnidades(fila.stock);
      const umbral = leerUnidades(fila.umbral);
      if (!stock.ok || !umbral.ok) continue;
      if (stock.valor !== item.stockActual) ajuste.stockActual = stock.valor;
      if (umbral.valor !== item.umbralAlerta) {
        ajuste.umbralAlerta = umbral.valor;
      }
    }
    if (Object.keys(ajuste).length > 1) ajustes.push(ajuste);
  }
  return ajustes;
}

/**
 * Llegó una versión nueva del servidor (una venta o un ajuste desde otra
 * pestaña) mientras el administrador editaba: los campos que no tocó toman
 * el valor nuevo y los que tocó quedan como los dejó. Los ítems nuevos se
 * suman y los que ya no están se quitan.
 */
export function fusionarConServidor(
  anteriores: readonly ItemStock[],
  nuevos: readonly ItemStock[],
  formulario: Readonly<FormularioStock>,
): FormularioStock {
  const previos = new Map(anteriores.map((item) => [item.id, item]));
  const resultado: FormularioStock = {};
  for (const nuevo of nuevos) {
    const previo = previos.get(nuevo.id);
    const fila = formulario[nuevo.id];
    if (!previo || !fila) {
      resultado[nuevo.id] = filaDesde(nuevo);
      continue;
    }
    const original = filaDesde(previo);
    const actualizada = filaDesde(nuevo);
    resultado[nuevo.id] = {
      controlaStock:
        fila.controlaStock === original.controlaStock
          ? actualizada.controlaStock
          : fila.controlaStock,
      stock: fila.stock === original.stock ? actualizada.stock : fila.stock,
      umbral:
        fila.umbral === original.umbral ? actualizada.umbral : fila.umbral,
    };
  }
  return resultado;
}

/** Cuántos ítems controlan stock y cuántos están en alerta. */
export function resumenStock(items: readonly ItemStock[]): {
  controlados: number;
  porAgotarse: number;
  agotados: number;
} {
  return {
    controlados: items.filter((i) => i.controlaStock).length,
    porAgotarse: items.filter((i) => i.alerta === "STOCK_CRITICO").length,
    agotados: items.filter((i) => i.alerta === "AGOTADO").length,
  };
}

/** «Se guardó 1 ítem.» o «Se guardaron 3 ítems.» */
export function textoGuardado(cantidad: number): string {
  return cantidad === 1
    ? "Se guardó 1 ítem."
    : `Se guardaron ${cantidad} ítems.`;
}

/** «Hay 2 cambios sin guardar.» o vacío. */
export function textoPendientes(cantidad: number): string {
  if (cantidad === 0) return "";
  return cantidad === 1
    ? "Hay 1 ítem con cambios sin guardar."
    : `Hay ${cantidad} ítems con cambios sin guardar.`;
}

/** Reemplaza por id los ítems que devolvió PATCH /admin/stock. */
export function reemplazarItems(
  items: readonly ItemStock[],
  guardados: readonly ItemStock[],
): ItemStock[] {
  const porId = new Map(guardados.map((item) => [item.id, item]));
  return items.map((item) => porId.get(item.id) ?? item);
}

/** Ids de los campos de cada fila. */
export function idCampoStock(itemId: string): string {
  return `stock-${itemId}`;
}
export function idCampoUmbral(itemId: string): string {
  return `umbral-${itemId}`;
}

/**
 * El campo al que va el foco al intentar guardar con errores: el primero
 * mal cargado, en el orden de la pantalla. Null si no hay errores.
 */
export function primerCampoConError(
  items: readonly ItemStock[],
  errores: Readonly<Record<string, ErroresFila>>,
): string | null {
  for (const item of items) {
    const error = errores[item.id];
    if (error?.stock) return idCampoStock(item.id);
    if (error?.umbral) return idCampoUmbral(item.id);
  }
  return null;
}

/**
 * Cuántas filas difieren de lo guardado, incluidas las que tienen errores
 * (para que «Guardar» se habilite y muestre el error). Sin control de stock
 * no cuentan las unidades ni el aviso: no se mandan.
 */
export function filasConCambios(
  items: readonly ItemStock[],
  formulario: Readonly<FormularioStock>,
): number {
  return items.filter((item) => {
    const fila = formulario[item.id];
    if (!fila) return false;
    if (fila.controlaStock !== item.controlaStock) return true;
    if (!fila.controlaStock) return false;
    return (
      fila.stock.trim() !== String(item.stockActual) ||
      fila.umbral.trim() !== String(item.umbralAlerta)
    );
  }).length;
}
