// Mismos valores que el enum MesaEstado y los DTOs de layout del backend
// (apps/backend/prisma/schema.prisma, apps/backend/src/mesas/dto/*.ts) — una
// sola fuente de verdad de nombres entre stacks, igual que ya hace
// types/pedido.ts con EstadoPedido.

export const FORMAS_MESA_VALIDAS = ['CIRCULO', 'CUADRADO', 'RECTANGULO'] as const;
export type FormaMesa = (typeof FORMAS_MESA_VALIDAS)[number];

export const ESTADOS_MESA_VALIDOS = ['LIBRE', 'OCUPADA', 'EN_PROCESO_DE_PAGO'] as const;
export type EstadoMesa = (typeof ESTADOS_MESA_VALIDOS)[number];

export interface MesaLayout {
  x: number;
  y: number;
  forma: FormaMesa;
  ancho: number;
  alto: number;
  rotacion: number;
}

/** Forma en la que responde GET /mesas/layout — ver MesasService.obtenerLayout. */
export interface MesaConLayout {
  id: string;
  numero: number;
  estado: EstadoMesa;
  // Nullable: mesas creadas antes de HU-016 (o nunca ubicadas todavía en el
  // editor) no tienen layout — ver comentario en schema.prisma.
  layout: MesaLayout | null;
}

/** Forma en la que se manda cada mesa en el body de POST /mesas/layout. */
export interface GuardarLayoutItem extends MesaLayout {
  // Ausente = mesa nueva (todavía no persistida) — MesasService.guardarLayout
  // la crea; presente = mesa existente, se actualiza su layout.
  id?: string;
  numero: number;
}

export interface GuardarLayoutPayload {
  restauranteId: string;
  mesas: GuardarLayoutItem[];
}

/** Payload del evento WS 'mesa:estado_actualizado' — ver KdsGateway.emitirEstadoMesa. */
export interface MesaEstadoActualizadoPayload {
  mesaId: string;
  estado: EstadoMesa;
  ts: number;
}