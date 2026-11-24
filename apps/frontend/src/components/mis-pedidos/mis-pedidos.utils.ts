/**
 * BL-502: «Mis pedidos» del comensal en la mesa.
 *
 * El navegador recuerda los ids de los pedidos que el comensal pagó desde
 * este dispositivo en la sesión abierta de la mesa. Se guardan en
 * localStorage (no en sessionStorage): al volver a escanear el QR el
 * teléfono abre otra pestaña, y sessionStorage empieza vacío en cada una.
 * La clave lleva la sesión de la mesa, así que al cerrarse la mesa la lista
 * queda vieja y se borra.
 *
 * El estado no se guarda acá: lo da el backend (POST /pedidos/mesa/estado),
 * que además filtra por la mesa y la sesión (HU-006, RD.05).
 *
 * Lógica pura, probada en test/unitarios/mis-pedidos.utils.spec.ts.
 */
import type { EstadoPedido } from "@/types/pedido";

/** POST con los ids; devuelve los de esta mesa y esta sesión. */
export const RUTA_ESTADO_PEDIDOS_MESA = "/pedidos/mesa/estado";

/** Mismo tope que MAXIMO_PEDIDOS_POR_CONSULTA en el backend. */
export const MAXIMO_PEDIDOS_RECORDADOS = 30;

const PREFIJO_CLAVE = "bistrolink:mis-pedidos";
const FORMATO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que devuelve el backend por pedido (PedidoDeLaMesa). */
export interface PedidoDeLaMesa {
  id: string;
  estado: EstadoPedido;
  creadoEn: string;
  actualizadoEn: string;
  lineas: { nombre: string; cantidad: number }[];
  consumo: string;
  propina: number;
}

/** Almacenamiento con las claves enumerables (localStorage o un Map en los tests). */
export interface AlmacenPersistente {
  readonly length: number;
  key(indice: number): string | null;
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

/** localStorage, o null si no hay (SSR) o el navegador lo bloquea. */
export function almacenPersistente(): AlmacenPersistente | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function prefijoDeLaMesa(qrToken: string): string {
  return `${PREFIJO_CLAVE}:${qrToken}:`;
}

/** Una lista por mesa y por sesión de la mesa. */
export function claveMisPedidos(qrToken: string, sesionMesa: string): string {
  return `${prefijoDeLaMesa(qrToken)}${sesionMesa}`;
}

/** Los ids recordados (los más nuevos primero). Nunca lanza. */
export function leerMisPedidos(
  almacen: AlmacenPersistente | null,
  clave: string,
): string[] {
  if (!almacen) return [];
  try {
    const crudo = almacen.getItem(clave);
    if (!crudo) return [];
    const datos: unknown = JSON.parse(crudo);
    if (!Array.isArray(datos)) return [];
    return datos
      .filter((id): id is string => typeof id === "string")
      .filter((id) => FORMATO_UUID.test(id))
      .slice(0, MAXIMO_PEDIDOS_RECORDADOS);
  } catch {
    return [];
  }
}

function escribir(
  almacen: AlmacenPersistente | null,
  clave: string,
  ids: readonly string[],
): void {
  if (!almacen) return;
  try {
    if (ids.length === 0) almacen.removeItem(clave);
    else almacen.setItem(clave, JSON.stringify(ids));
  } catch {
    // Almacenamiento lleno o bloqueado: no se recuerda, nada más.
  }
}

/** Agrega un pedido al principio (sin repetir y con tope). Devuelve la lista. */
export function recordarPedido(
  almacen: AlmacenPersistente | null,
  clave: string,
  pedidoId: string,
): string[] {
  if (!FORMATO_UUID.test(pedidoId)) return leerMisPedidos(almacen, clave);
  const ids = [
    pedidoId,
    ...leerMisPedidos(almacen, clave).filter((id) => id !== pedidoId),
  ].slice(0, MAXIMO_PEDIDOS_RECORDADOS);
  escribir(almacen, clave, ids);
  return ids;
}

/** Deja solo los ids que el backend reconoció como de esta mesa y sesión. */
export function conservarSolo(
  almacen: AlmacenPersistente | null,
  clave: string,
  vigentes: readonly string[],
): void {
  const ids = leerMisPedidos(almacen, clave).filter((id) =>
    vigentes.includes(id),
  );
  escribir(almacen, clave, ids);
}

/** Borra la lista (por ejemplo, la mesa se cerró). */
export function olvidarMisPedidos(
  almacen: AlmacenPersistente | null,
  clave: string,
): void {
  escribir(almacen, clave, []);
}

/**
 * Borra lo guardado de sesiones anteriores de esta misma mesa: la lista de
 * «Mis pedidos» y el pago en curso (BL-448). Ya no se pueden consultar (el
 * backend las rechaza) y no tienen por qué quedar en el teléfono.
 */
export function limpiarSesionesAnteriores(
  almacen: AlmacenPersistente | null,
  qrToken: string,
  sesionMesa: string,
): void {
  if (!almacen) return;
  try {
    const prefijos = [
      prefijoDeLaMesa(qrToken),
      `bistrolink:pedido-en-curso:mesa:${qrToken}:`,
    ];
    const viejas: string[] = [];
    for (let i = 0; i < almacen.length; i++) {
      const clave = almacen.key(i);
      const prefijo = prefijos.find((p) => clave?.startsWith(p));
      if (clave && prefijo && clave !== `${prefijo}${sesionMesa}`) {
        viejas.push(clave);
      }
    }
    for (const clave of viejas) almacen.removeItem(clave);
  } catch {
    // Nada que hacer.
  }
}

/** Estados en los que el pedido todavía no llegó a la mesa. */
const EN_CAMINO: ReadonlySet<EstadoPedido> = new Set([
  "PENDIENTE_PAGO",
  "RECIBIDO",
  "EN_PREPARACION",
  "LISTO_PARA_ENTREGAR",
]);

export function estaEnCamino(estado: EstadoPedido): boolean {
  return EN_CAMINO.has(estado);
}

/** Cuántos pedidos faltan llegar. */
export function pedidosEnCamino(pedidos: readonly PedidoDeLaMesa[]): number {
  return pedidos.filter((p) => estaEnCamino(p.estado)).length;
}

/** Total del pedido: consumo más propina. */
export function totalDelPedido(pedido: PedidoDeLaMesa): number {
  return Number(pedido.consumo) + pedido.propina;
}

/** «1 Milanesa · 2 Agua». */
export function resumenDeLineas(pedido: PedidoDeLaMesa): string {
  return pedido.lineas.map((l) => `${l.cantidad} ${l.nombre}`).join(" · ");
}

/** El estado que más le importa al comensal, primero. */
const PRIORIDAD: readonly EstadoPedido[] = [
  "LISTO_PARA_ENTREGAR",
  "EN_PREPARACION",
  "RECIBIDO",
  "PENDIENTE_PAGO",
];

const TEXTO_RESUMEN: Partial<Record<EstadoPedido, [string, string]>> = {
  LISTO_PARA_ENTREGAR: ["listo", "listos"],
  EN_PREPARACION: ["en preparación", "en preparación"],
  RECIBIDO: ["en cocina", "en cocina"],
  PENDIENTE_PAGO: ["esperando el pago", "esperando el pago"],
};

/**
 * Segunda línea del botón «Mis pedidos»: el estado más avanzado de los que
 * faltan («1 listo», «2 en preparación») o, si ya llegaron todos, que
 * están entregados.
 */
export function resumenMisPedidos(pedidos: readonly PedidoDeLaMesa[]): string {
  for (const estado of PRIORIDAD) {
    const cantidad = pedidos.filter((p) => p.estado === estado).length;
    const textos = TEXTO_RESUMEN[estado];
    if (cantidad > 0 && textos) {
      return `${cantidad} ${cantidad === 1 ? textos[0] : textos[1]}`;
    }
  }
  return pedidos.some((p) => p.estado === "ENTREGADO")
    ? "Todo entregado"
    : "Sin pedidos en curso";
}

export type TonoEstado = "espera" | "listo" | "entregado" | "cancelado";

/** Color de la etiqueta del estado. */
export function tonoDelEstado(estado: EstadoPedido): TonoEstado {
  if (estado === "ENTREGADO") return "entregado";
  if (estado === "CANCELADO") return "cancelado";
  if (estado === "LISTO_PARA_ENTREGAR") return "listo";
  return "espera";
}

/** Hora local «20:41» de una fecha ISO. */
export function horaCorta(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  return fecha.toLocaleTimeString("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Aplica un cambio de estado que llegó por el WebSocket. */
export function aplicarActualizacion(
  pedidos: readonly PedidoDeLaMesa[],
  cambio: { id: string; estado: EstadoPedido; actualizadoEn?: string },
): PedidoDeLaMesa[] {
  return pedidos.map((p) =>
    p.id === cambio.id
      ? {
          ...p,
          estado: cambio.estado,
          actualizadoEn: cambio.actualizadoEn ?? p.actualizadoEn,
        }
      : p,
  );
}
