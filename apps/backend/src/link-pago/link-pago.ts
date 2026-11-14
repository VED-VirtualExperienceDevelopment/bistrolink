import { nonceCoincide } from './link-pago-token';

/**
 * HU-033 (BL-203): reglas del link de pago, sin base de datos (probadas en
 * test/unitarios/link-pago.spec.ts).
 */

/** Header con el token del link en los pedidos que se pagan por link. */
export const HEADER_LINK_PAGO = 'x-link-pago';

export const CODIGO_LINK_VENCIDO = 'LINK_PAGO_VENCIDO';
export const CODIGO_LINK_REEMPLAZADO = 'LINK_PAGO_REEMPLAZADO';
export const CODIGO_LINK_CANCELADO = 'LINK_PAGO_CANCELADO';
export const CODIGO_LINK_CADUCADO = 'LINK_PAGO_CADUCADO';
/** 409 al generar: el pedido ya tiene un link vigente (otro colaborador). */
export const CODIGO_LINK_ACTIVO = 'LINK_PAGO_ACTIVO';

/**
 * Hasta cuándo sirve el link para consultar el pedido después de vencer
 * (estado del pago y comprobante). Pasado ese plazo no sirve para nada: el
 * comprobante de una e-Factura tiene el RUT y la razón social del cliente,
 * y un link viejo puede quedar en un chat o en el historial (Ley 18.331).
 */
export const PLAZO_CONSULTA_LINK_MS = 24 * 60 * 60 * 1000;

export const MENSAJE_LINK_INVALIDO = 'Link de pago no válido';
export const MENSAJE_LINK_VENCIDO =
  'Este link de pago venció. Pedile al mozo uno nuevo.';
export const MENSAJE_LINK_REEMPLAZADO =
  'Este link de pago fue reemplazado por otro. Pedile al mozo el nuevo.';
export const MENSAJE_LINK_CANCELADO = 'Este pedido fue cancelado.';
export const MENSAJE_LINK_CADUCADO =
  'Este link de pago ya no está disponible. Si necesitás el comprobante, pedíselo al local.';
export const MENSAJE_LINK_ACTIVO =
  'Ya hay un link de pago activo para este pedido. Si generás otro, el anterior deja de servir.';
export const MENSAJE_PAGO_EN_CURSO =
  'Hay un pago en curso para este pedido. Esperá a que se resuelva antes de generar un link.';
export const MENSAJE_NO_ESPERA_PAGO = 'Este pedido ya no espera el pago';

/**
 * - vigente: se puede pagar.
 * - pagado: el pedido ya se pagó (se puede ver el estado y el comprobante).
 * - vencido: pasó el plazo sin pagar.
 * - reemplazado: el mozo generó otro link (o este no es el del pedido).
 * - cancelado: el pedido se canceló sin pagar.
 * - caducado: pasó el plazo de consulta (PLAZO_CONSULTA_LINK_MS) desde que
 *   venció; ya no sirve ni para mirar.
 */
export type EstadoLinkPago =
  'vigente' | 'pagado' | 'vencido' | 'reemplazado' | 'cancelado' | 'caducado';

export interface PedidoConLink {
  estado: string;
  linkPagoHash: string | null;
  linkPagoVenceEn: Date | null;
}

export function estadoDelLink(
  pedido: PedidoConLink,
  nonce: string,
  ahora: Date,
): EstadoLinkPago {
  if (!nonceCoincide(nonce, pedido.linkPagoHash)) return 'reemplazado';
  if (pedido.estado === 'CANCELADO') return 'cancelado';
  if (
    pedido.linkPagoVenceEn &&
    ahora.getTime() >= pedido.linkPagoVenceEn.getTime() + PLAZO_CONSULTA_LINK_MS
  ) {
    return 'caducado';
  }
  if (pedido.estado !== 'PENDIENTE_PAGO') return 'pagado';
  if (!pedido.linkPagoVenceEn || pedido.linkPagoVenceEn <= ahora) {
    return 'vencido';
  }
  return 'vigente';
}

/**
 * Con el link se puede consultar el pedido (estado del pago, comprobante)
 * mientras sea el link vigente del pedido, aunque haya vencido: un pago que
 * se está verificando cuando vence el link tiene que poder seguirse. Pagar
 * (o cualquier otra acción) solo con el link vigente. Caducado (pasado el
 * plazo de consulta), nada.
 */
export function linkPermite(estado: EstadoLinkPago, soloLectura: boolean) {
  if (
    estado === 'reemplazado' ||
    estado === 'cancelado' ||
    estado === 'caducado'
  ) {
    return false;
  }
  return soloLectura || estado === 'vigente';
}

export function mensajeDelLink(estado: EstadoLinkPago): string {
  switch (estado) {
    case 'vencido':
      return MENSAJE_LINK_VENCIDO;
    case 'reemplazado':
      return MENSAJE_LINK_REEMPLAZADO;
    case 'cancelado':
      return MENSAJE_LINK_CANCELADO;
    case 'caducado':
      return MENSAJE_LINK_CADUCADO;
    default:
      return MENSAJE_NO_ESPERA_PAGO;
  }
}

export function codigoDelLink(estado: EstadoLinkPago): string | null {
  switch (estado) {
    case 'vencido':
      return CODIGO_LINK_VENCIDO;
    case 'reemplazado':
      return CODIGO_LINK_REEMPLAZADO;
    case 'cancelado':
      return CODIGO_LINK_CANCELADO;
    case 'caducado':
      return CODIGO_LINK_CADUCADO;
    default:
      return null;
  }
}

/**
 * El pedido tiene un link que todavía se puede pagar: generar otro sin
 * avisar dejaría sin servir el que quizás ya tiene el comensal.
 */
export function hayLinkVigente(
  pedido: Pick<PedidoConLink, 'linkPagoHash' | 'linkPagoVenceEn'>,
  ahora: Date,
): boolean {
  return (
    pedido.linkPagoHash !== null &&
    pedido.linkPagoVenceEn !== null &&
    pedido.linkPagoVenceEn > ahora
  );
}

/** Hasta cuándo sirve un link generado `ahora`. */
export function venceEn(ahora: Date, duracionMs: number): Date {
  return new Date(ahora.getTime() + duracionMs);
}

/** URL pública del frontend sin barras finales. */
export function sinBarraFinal(url: string): string {
  let base = url;
  while (base.endsWith('/')) base = base.slice(0, -1);
  return base;
}
