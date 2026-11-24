/**
 * HU-011 (BL-488): puerto de la integración con el POS del local (ADR 0001,
 * puertos y adaptadores). El resto del sistema solo conoce esta interfaz:
 * para conectar un POS real se agrega su adaptador, sin tocar la lógica de
 * negocio. Hoy hay dos: el mock en memoria (desarrollo, pruebas y demo) y el
 * HTTP contra la API de POS que define BistroLink (contrato PactJS).
 *
 * Integración de tipo add-on y en los dos sentidos: BistroLink le manda al
 * POS las ventas que ya cobró (BL-488) y trae las que se hicieron
 * directamente en el POS para el dashboard (BL-489). Nunca modifica lo que el
 * POS registra por su cuenta.
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
 * HU-011 (BL-489): una venta tal como la tiene el POS, para traer al
 * dashboard las que se hicieron directamente ahí.
 */
export interface VentaDelPos {
  /** Id de la venta en el POS. */
  idPos: string;
  /**
   * La referencia con que la mandó BistroLink (id del pedido), o null si se
   * hizo en el POS. Las que tienen referencia no se importan: ya son pagos.
   */
  referencia: string | null;
  /** Cuándo se hizo la venta, ISO 8601. */
  fecha: string;
  /** Pesos uruguayos, con 2 decimales. */
  total: number;
  /** Como lo informa el POS (EFECTIVO, CREDITO, DEBITO…). */
  medioPago: string;
  anulada: boolean;
  /** Último cambio de la venta (alta o anulación), ISO 8601. */
  actualizadaEn: string;
}

/** Qué ventas pedirle al POS. */
export interface ConsultaVentasPos {
  /** Id del establecimiento en BistroLink (tenant). */
  establecimiento: string;
  /** Ventas creadas o cambiadas desde este momento (incluido). */
  desde: Date;
  /** Máximo de ventas por consulta, ordenadas por `actualizadaEn`. */
  limite: number;
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
  /**
   * HU-011 (BL-489): las ventas del establecimiento creadas o cambiadas
   * desde `desde`, de la más vieja a la más nueva, hasta `limite`.
   */
  listarVentas(consulta: ConsultaVentasPos): Promise<VentaDelPos[]>;
}

/** Token de inyección del adaptador elegido por POS_ADAPTER. */
export const POS_ADAPTER = Symbol('POS_ADAPTER');
