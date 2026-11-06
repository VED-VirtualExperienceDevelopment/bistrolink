import type { EstadoPedido, Pedido } from "@/types/pedido";

/**
 * HU-042 (BL-466, ADR 0010): cola de pedidos del KDS.
 * Lógica pura del tablero y del seguimiento del comensal (probada en
 * test/unitarios/cola-kds.utils.spec.ts).
 */

/** Lugar de un pedido en la cola (evento `pedido:cola` y `orden` de la cola). */
export interface PosicionEnCola {
  pedidoId: string;
  /** 1 = el próximo en pasar a preparación. */
  posicion: number;
  minutosEstimados: number;
}

/** Evento `cola:actualizada`: mismo shape que EstadoCola del backend. */
export interface EstadoCola {
  activa: boolean;
  limite: number | null;
  enPreparacion: number;
  enEspera: number;
  umbralAlerta: number;
  altaDemanda: boolean;
  /** Tiempo estimado para un pedido que llega ahora. */
  minutosEstimados: number;
  orden: PosicionEnCola[];
}

/** Pedido en espera, con su lugar en la cola si el servidor ya lo mandó. */
export interface PedidoEnEspera {
  pedido: Pedido;
  posicion: number | null;
}

/**
 * Separa el tablero: con la cola activa, los pedidos en RECIBIDO van a
 * «En espera» en el orden de la cola (FIFO); el resto queda en el tablero de
 * siempre. Un pedido en RECIBIDO que todavía no está en el orden (llegó antes
 * que el evento de la cola) va al final, sin número. Sin cola activa, todo
 * queda como antes.
 */
export function separarPorCola(
  pedidos: Pedido[],
  cola: EstadoCola | null,
): { enEspera: PedidoEnEspera[]; activos: Pedido[] } {
  if (!cola?.activa) {
    return { enEspera: [], activos: pedidos };
  }
  const posiciones = new Map(
    cola.orden.map(({ pedidoId, posicion }) => [pedidoId, posicion]),
  );
  const enEspera: PedidoEnEspera[] = pedidos
    .filter((pedido) => pedido.estado === "RECIBIDO")
    .map((pedido) => ({ pedido, posicion: posiciones.get(pedido.id) ?? null }))
    .sort((a, b) => {
      if (a.posicion === null && b.posicion === null) {
        return (
          new Date(a.pedido.createdAt).getTime() -
          new Date(b.pedido.createdAt).getTime()
        );
      }
      if (a.posicion === null) return 1;
      if (b.posicion === null) return -1;
      return a.posicion - b.posicion;
    });
  const activos = pedidos.filter((pedido) => pedido.estado !== "RECIBIDO");
  return { enEspera, activos };
}

/** Contador del encabezado: «En preparación 3 de 5 · En espera 2». */
export function textoContadorCola(cola: EstadoCola): string {
  return `En preparación ${cola.enPreparacion} de ${cola.limite} · En espera ${cola.enEspera}`;
}

/** Aviso de alta demanda (texto, no solo color: WCAG 1.4.1). */
export function textoAltaDemanda(cola: EstadoCola): string {
  return `Alta demanda: ${cola.enEspera} pedidos en espera (más de ${cola.umbralAlerta}). Los nuevos esperan unos ${cola.minutosEstimados} min.`;
}

/**
 * Etiqueta del estado en la comanda: con la cola activa, RECIBIDO se muestra
 * como «En espera». Sin cola, la etiqueta de siempre.
 */
export function etiquetaEstadoConCola(
  estado: EstadoPedido,
  etiquetaBase: string,
  colaActiva: boolean,
): string {
  return colaActiva && estado === "RECIBIDO" ? "En espera" : etiquetaBase;
}

/** Texto para el comensal: «En cola · posición 2 · unos 21 min». */
export function textoEnCola(lugar: PosicionEnCola): string {
  return `En cola · posición ${lugar.posicion} · unos ${lugar.minutosEstimados} min`;
}

/**
 * El lugar en la cola solo vale mientras el pedido sigue en RECIBIDO: al
 * pasar a preparación (o a cualquier otro estado) se deja de mostrar.
 */
export function lugarVigente(
  estado: EstadoPedido,
  lugar: PosicionEnCola | null,
): PosicionEnCola | null {
  return estado === "RECIBIDO" ? lugar : null;
}
