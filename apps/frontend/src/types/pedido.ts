// EstadoPedido coincide 1:1 con el enum PedidoEstado del schema.prisma
// (apps/backend/prisma/schema.prisma) — misma fuente de verdad en todo
// el stack, sin traducción intermedia entre backend y frontend. Para
// mostrar un texto legible en la UI, ver ESTADO_LABEL en OrderTicket.tsx
// (eso es solo una etiqueta de visualización, no cambia este tipo).
export type EstadoPedido =
  | 'RECIBIDO'
  | 'EN_PREPARACION'
  | 'LISTO_PARA_ENTREGAR'
  | 'ENTREGADO'
  | 'CANCELADO';

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