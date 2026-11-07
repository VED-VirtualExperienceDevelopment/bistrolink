/**
 * HU-024 (BL-104): cancelación de un pedido pagado desde el KDS (mozo y
 * administrador). Lógica pura del diálogo (probada en
 * test/unitarios/cancelacion.utils.spec.ts).
 */

export type MotivoCancelacion =
  | "ERROR_PEDIDO"
  | "RECLAMO_CLIENTE"
  | "PRODUCTO_NO_DISPONIBLE"
  | "COBRO_DUPLICADO"
  | "OTRO";

/** Mismos motivos y textos que el backend (CancelarPedidoDto). */
export const MOTIVOS_CANCELACION: ReadonlyArray<{
  codigo: MotivoCancelacion;
  nombre: string;
}> = [
  { codigo: "ERROR_PEDIDO", nombre: "Error en el pedido" },
  { codigo: "RECLAMO_CLIENTE", nombre: "Reclamo del cliente" },
  { codigo: "PRODUCTO_NO_DISPONIBLE", nombre: "Producto no disponible" },
  { codigo: "COBRO_DUPLICADO", nombre: "Cobro duplicado" },
  { codigo: "OTRO", nombre: "Otro" },
];

export const LARGO_MAXIMO_DETALLE = 200;

/** Una devolución (backend: DevolucionDelPago). */
export interface DevolucionDelPago {
  pagoId: string;
  medio: string;
  monto: string;
  /** true: la hace BistroLink (Mercado Pago); false: el mozo, a mano. */
  automatica: boolean;
}

/** Respuesta de GET /pedidos/:id/cancelacion. */
export interface VistaPreviaCancelacion {
  pedidoId: string;
  estado: string;
  monto: string;
  motivoNoCancelable: string | null;
  devoluciones: DevolucionDelPago[];
  repondraStock: boolean;
}

/** Respuesta de POST /pedidos/:id/cancelacion. */
export interface PedidoCancelado {
  pedidoId: string;
  estado: "CANCELADO";
  monto: string;
  devoluciones: DevolucionDelPago[];
  stockRepuesto: boolean;
}

export function rutaCancelacion(pedidoId: string): string {
  return `/pedidos/${encodeURIComponent(pedidoId)}/cancelacion`;
}

/** Se puede cancelar desde el KDS: recibido o en preparación. */
export function sePuedeCancelar(estado: string): boolean {
  return estado === "RECIBIDO" || estado === "EN_PREPARACION";
}

const NOMBRE_MEDIO: Readonly<Record<string, string>> = {
  MERCADOPAGO: "Mercado Pago",
  EFECTIVO: "efectivo",
  POS_CREDITO: "crédito (POS del local)",
  POS_DEBITO: "débito (POS del local)",
};

export function nombreDelMedio(medio: string): string {
  return NOMBRE_MEDIO[medio] ?? medio;
}

/**
 * Qué tiene que hacer el mozo con cada pago, antes de confirmar. Mercado Pago
 * se devuelve solo; el efectivo y el POS, a mano.
 */
export function instruccionDeDevolucion(d: DevolucionDelPago): string {
  if (d.automatica) {
    return `Se reembolsa por ${nombreDelMedio(d.medio)} automáticamente.`;
  }
  if (d.medio === "EFECTIVO") {
    return "Devolvé el efectivo al comensal.";
  }
  return "Anulá el cobro en el POS del local.";
}

/** Hay pagos que el mozo tiene que devolver a mano. */
export function requiereDevolucionManual(
  vista: Pick<VistaPreviaCancelacion, "devoluciones">,
): boolean {
  return vista.devoluciones.some((d) => !d.automatica);
}

export interface FormularioCancelacion {
  motivo: MotivoCancelacion | "";
  detalle: string;
  devolucionConfirmada: boolean;
}

/** Error a mostrar, o null si se puede confirmar. */
export function errorDelFormulario(
  formulario: FormularioCancelacion,
  vista: Pick<VistaPreviaCancelacion, "devoluciones">,
): string | null {
  if (formulario.motivo === "") return "Elegí el motivo de la cancelación.";
  const detalle = formulario.detalle.trim();
  if (formulario.motivo === "OTRO" && detalle === "") {
    return "Contá brevemente el motivo.";
  }
  if (detalle.length > LARGO_MAXIMO_DETALLE) {
    return `El detalle puede tener hasta ${LARGO_MAXIMO_DETALLE} caracteres.`;
  }
  if (requiereDevolucionManual(vista) && !formulario.devolucionConfirmada) {
    return "Confirmá que hiciste la devolución.";
  }
  return null;
}

/** Body del POST: el detalle solo si se escribió. */
export function cuerpoDeCancelacion(formulario: FormularioCancelacion): {
  motivo: MotivoCancelacion;
  detalle?: string;
  devolucionManualConfirmada: boolean;
} {
  const detalle = formulario.detalle.trim().replace(/\s+/g, " ");
  return {
    motivo: formulario.motivo as MotivoCancelacion,
    ...(detalle ? { detalle } : {}),
    devolucionManualConfirmada: formulario.devolucionConfirmada,
  };
}
