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
  /**
   * HU-040 (BL-210): pedido para retirar, con su código y, si el comensal
   * lo dejó, su nombre. Null en los pedidos de mesa.
   */
  retiro: { codigo: string; nombre: string | null } | null;
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
  /** HU-040 (BL-210): opcionales para los que todavía no los leen. */
  codigoRetiro?: string | null;
  retiroNombre?: string | null;
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
    retiro: p.codigoRetiro
      ? { codigo: p.codigoRetiro, nombre: p.retiroNombre ?? null }
      : null,
    lineas: p.lineas.map((l) => ({
      id: l.id,
      nombreSnapshot: l.nombreSnapshot,
      cantidad: l.cantidad,
      observacion: l.observacion,
    })),
  };
}
