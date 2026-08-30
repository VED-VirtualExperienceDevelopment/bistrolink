export type EstadoPedido = 'Recibido' | 'En preparación' | 'Listo para entregar' | 'Entregado' | 'Cancelado';

export interface LineaPedido {
  id: string;
  nombreSnapshot: string;
  cantidad: number;
  observacion?: string; // HU-021, opcional — no todos los pedidos lo tendrán todavía
}

export interface Pedido {
  id: string;
  mesaNumero: number;
  estado: EstadoPedido;
  createdAt: string; // ISO timestamp — hora de recepción
  lineas: LineaPedido[];
  observacionGeneral?: string; // HU-021
}