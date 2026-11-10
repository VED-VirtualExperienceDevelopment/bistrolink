/**
 * HU-038 (BL-510): monitor de Cocina. El /kds de Cocina es una pantalla de
 * solo lectura: muestra sin scroll las comandas en curso y un resumen grande
 * para leer de lejos.
 * Lógica pura (probada en test/unitarios/monitor-cocina.utils.spec.ts).
 */
import type { Pedido } from "@/types/pedido";

/** Tamaño de las tarjetas según cuántas comandas hay. */
export type DensidadMonitor = "grande" | "media" | "compacta";

/**
 * Ancho mínimo de cada tarjeta (px) por densidad. Con pocas comandas, las
 * tarjetas son grandes; con muchas, se achican hasta el mínimo legible.
 */
export const ANCHO_MINIMO_TARJETA: Readonly<Record<DensidadMonitor, number>> = {
  grande: 420,
  media: 340,
  compacta: 280,
};

export interface ResumenMonitor {
  enPreparacion: number;
  listos: number;
  /** Recibidos: esperan que se libere un lugar o que el mozo los pase. */
  enEspera: number;
}

const ms = (pedido: Pedido) => new Date(pedido.createdAt).getTime();
const ordenEstado = (pedido: Pedido) =>
  pedido.estado === "EN_PREPARACION" ? 0 : 1;

/**
 * Las comandas que tienen tarjeta en el monitor: en preparación y listas
 * para entregar. Primero las que están en preparación y, dentro de cada
 * estado, de la más vieja a la más nueva. Si no entran todas, se ocultan
 * desde el final: lo último en irse es lo que la cocina está preparando.
 */
export function comandasDelMonitor(pedidos: readonly Pedido[]): Pedido[] {
  return pedidos
    .filter(
      (pedido) =>
        pedido.estado === "EN_PREPARACION" ||
        pedido.estado === "LISTO_PARA_ENTREGAR",
    )
    .sort((a, b) => ordenEstado(a) - ordenEstado(b) || ms(a) - ms(b));
}

/** Cuántos pedidos hay en cada estado, para la barra de resumen. */
export function resumenMonitor(pedidos: readonly Pedido[]): ResumenMonitor {
  const contar = (estado: Pedido["estado"]) =>
    pedidos.filter((pedido) => pedido.estado === estado).length;
  return {
    enPreparacion: contar("EN_PREPARACION"),
    listos: contar("LISTO_PARA_ENTREGAR"),
    enEspera: contar("RECIBIDO"),
  };
}

/** Densidad de la grilla según la cantidad de comandas con tarjeta. */
export function densidadMonitor(cantidad: number): DensidadMonitor {
  if (cantidad <= 4) return "grande";
  if (cantidad <= 9) return "media";
  return "compacta";
}

/** «2 de 5» con la cola activa (HU-042), o «2» si no hay límite. */
export function textoEnPreparacion(
  enPreparacion: number,
  limite: number | null,
): string {
  return limite === null
    ? String(enPreparacion)
    : `${enPreparacion} de ${limite}`;
}

/** Aviso de las comandas que no entran en la pantalla. */
export function textoOcultas(cantidad: number): string {
  return cantidad === 1 ? "+1 pedido más" : `+${cantidad} pedidos más`;
}

/** Las comandas de una mesa, en el monitor. */
export interface GrupoMesaMonitor {
  mesaNumero: number;
  pedidos: Pedido[];
}

/**
 * Agrupa por mesa las comandas, que ya vienen ordenadas por
 * comandasDelMonitor. Las mesas quedan en el orden de su comanda más
 * urgente (la primera que aparece) y, dentro de cada mesa, se respeta ese
 * mismo orden: primero en preparación y después listas, de la más vieja a
 * la más nueva.
 */
export function agruparPorMesa(
  comandas: readonly Pedido[],
): GrupoMesaMonitor[] {
  const grupos = new Map<number, Pedido[]>();
  for (const pedido of comandas) {
    const grupo = grupos.get(pedido.mesaNumero) ?? [];
    grupo.push(pedido);
    grupos.set(pedido.mesaNumero, grupo);
  }
  return [...grupos.entries()].map(([mesaNumero, pedidos]) => ({
    mesaNumero,
    pedidos,
  }));
}

/** Cuántas comandas tiene cada mesa (para el título del grupo). */
export function comandasPorMesa(
  comandas: readonly Pedido[],
): ReadonlyMap<number, number> {
  const cuenta = new Map<number, number>();
  for (const pedido of comandas) {
    cuenta.set(pedido.mesaNumero, (cuenta.get(pedido.mesaNumero) ?? 0) + 1);
  }
  return cuenta;
}
