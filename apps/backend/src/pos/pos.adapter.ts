/**
 * HU-011 (BL-488): puerto de la integración con el POS del local (ADR 0001,
 * puertos y adaptadores). El resto del sistema solo conoce esta interfaz:
 * para conectar un POS real se agrega su adaptador, sin tocar la lógica de
 * negocio. Hoy hay dos: el mock en memoria (desarrollo, pruebas y demo) y el
 * HTTP contra la API de POS que define BistroLink (contrato PactJS).
 *
 * Integración de tipo add-on: BistroLink le manda al POS las ventas que ya
 * cobró, para que el local las tenga en su sistema, y nunca modifica lo que
 * el POS registra por su cuenta.
 */

/** Una línea de la venta, con los precios del momento del pedido. */
export interface LineaVentaPos {
  descripcion: string;
  cantidad: number;
  /** Pesos uruguayos, con 2 decimales. */
  precioUnitario: number;
  subtotal: number;
}

/** Lo que BistroLink le manda al POS. Sin datos personales del comensal. */
export interface VentaPos {
  /**
   * Clave de idempotencia: el id del pedido en BistroLink. Si el POS ya
   * tiene una venta con esta referencia, devuelve esa y no crea otra.
   */
  referencia: string;
  /** Cuándo se confirmó el pago, ISO 8601. */
  fecha: string;
  moneda: 'UYU';
  total: number;
  /** Medio con que se cobró en BistroLink (EFECTIVO, MERCADOPAGO, POS_CREDITO…). */
  medioPago: string;
  /** Número de mesa; null en los pedidos para retirar. */
  mesa: number | null;
  lineas: LineaVentaPos[];
}

export interface VentaRegistradaPos {
  /** Id de la venta en el POS. */
  idPos: string;
}

/**
 * El POS no respondió o no está disponible (red, timeout, 5xx). La venta se
 * reintenta sola.
 */
export class PosNoDisponibleError extends Error {
  constructor(message = 'El POS no está disponible') {
    super(message);
    this.name = 'PosNoDisponibleError';
  }
}

/**
 * El POS rechazó el pedido (4xx que no es un duplicado): reintentar no lo
 * arregla. Queda con error para que el administrador lo revise.
 */
export class PosRechazoError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PosRechazoError';
  }
}

export interface PosAdapter {
  /** Nombre para los logs y el panel («mock», «http»). */
  readonly nombre: string;
  /** Idempotente por `venta.referencia`. */
  registrarVenta(venta: VentaPos): Promise<VentaRegistradaPos>;
  /** Idempotente: anular una venta ya anulada no es un error. */
  anularVenta(idPos: string, motivo: string): Promise<void>;
}

/** Token de inyección del adaptador elegido por POS_ADAPTER. */
export const POS_ADAPTER = Symbol('POS_ADAPTER');
