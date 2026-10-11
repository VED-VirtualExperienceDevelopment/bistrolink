import type { PedidoEstado } from '@prisma/client';

/**
 * BL-244: forma ÚNICA de un pedido para el KDS, alineada 1:1 con el tipo
 * `Pedido` del frontend (apps/frontend/src/types/pedido.ts).
 *
 * La usan los dos canales por los que un pedido llega al tablero:
 * - `pedidos:snapshot` (al conectar / reconectar) → listarPendientes()
 * - `pedido:nuevo` (en vivo, al crearse el pedido) → PedidosService.crear()
 *
 * Antes, `pedido:nuevo` emitía el objeto crudo de Prisma: sin `mesaNumero`
 * (solo `mesaId`) y con campos de más (precios, idempotencyKey...). El KDS
 * agrupa y titula las tarjetas por `mesaNumero`, así que el pedido en vivo
 * quedaba como «Mesa» sin número, en un grupo aparte al final del tablero,
 * fuera de la vista; recién al refrescar (snapshot) aparecía bien.
 */
export interface PedidoKds {
  id: string;
  mesaNumero: number;
  estado: PedidoEstado;
  createdAt: string;
  observacionGeneral: string | null;
  lineas: {
    id: string;
    nombreSnapshot: string;
    cantidad: number;
    observacion: string | null;
  }[];
}

/** Lo mínimo que hace falta leer de la base para armar un `PedidoKds`. */
export interface PedidoParaKds {
  id: string;
  estado: PedidoEstado;
  createdAt: Date;
  observacionGeneral: string | null;
  mesa: { numero: number };
  lineas: {
    id: string;
    nombreSnapshot: string;
    cantidad: number;
    observacion: string | null;
  }[];
}

export function aPedidoKds(p: PedidoParaKds): PedidoKds {
  return {
    id: p.id,
    mesaNumero: p.mesa.numero,
    estado: p.estado,
    createdAt: p.createdAt.toISOString(),
    observacionGeneral: p.observacionGeneral,
    lineas: p.lineas.map((l) => ({
      id: l.id,
      nombreSnapshot: l.nombreSnapshot,
      cantidad: l.cantidad,
      observacion: l.observacion,
    })),
  };
}
