/**
 * HU-033 (BL-203): página del link de pago (/pagar/<token>). Lógica pura,
 * probada en test/unitarios/link-pago.utils.spec.ts.
 */

/** Ruta del backend con el pedido del link (header X-Link-Pago). */
export const RUTA_LINK_PAGO = "/link-pago";

/** Códigos del 410 del backend (link-pago.ts). */
export const CODIGO_LINK_VENCIDO = "LINK_PAGO_VENCIDO";
export const CODIGO_LINK_REEMPLAZADO = "LINK_PAGO_REEMPLAZADO";
export const CODIGO_LINK_CANCELADO = "LINK_PAGO_CANCELADO";
export const CODIGO_LINK_CADUCADO = "LINK_PAGO_CADUCADO";

/** Un token del link: base64url de 103 caracteres (con margen). */
export function esTokenDeLinkValido(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,128}$/.test(token);
}

/** Lo que devuelve GET /link-pago. */
export interface ResumenLinkPago {
  pedidoId: string;
  estadoPedido: string;
  restaurante: { nombre: string };
  mesaNumero: number | null;
  lineas: {
    itemCartaId: string;
    nombre: string;
    cantidad: number;
    precio: string;
  }[];
  consumo: string;
  venceEn: string | null;
}

export type AvisoLink = {
  icono: string;
  titulo: string;
  detalle: string;
};

export const AVISO_LINK_INVALIDO: AvisoLink = {
  icono: "🔗",
  titulo: "Este link de pago no es válido.",
  detalle: "Revisá que esté completo o pedile al mozo uno nuevo.",
};

export const AVISO_LINK_VENCIDO: AvisoLink = {
  icono: "⏱️",
  titulo: "Este link de pago venció.",
  detalle: "Pedile al mozo que te genere uno nuevo.",
};

export const AVISO_LINK_REEMPLAZADO: AvisoLink = {
  icono: "🔄",
  titulo: "Este link de pago fue reemplazado.",
  detalle: "El mozo generó otro link. Pedile el nuevo.",
};

export const AVISO_LINK_CANCELADO: AvisoLink = {
  icono: "🚫",
  titulo: "Este pedido fue cancelado.",
  detalle: "Si fue un error, consultá al personal del local.",
};

/** Pasaron 24 h desde que venció: ya no sirve ni para ver el comprobante. */
export const AVISO_LINK_CADUCADO: AvisoLink = {
  icono: "🔒",
  titulo: "Este link de pago ya no está disponible.",
  detalle: "Si necesitás el comprobante, pedíselo al local.",
};

export const AVISO_LINK_ERROR: AvisoLink = {
  icono: "⚠️",
  titulo: "No pudimos abrir el link de pago.",
  detalle: "Revisá tu conexión y volvé a intentarlo.",
};

/**
 * Qué mostrar si el backend rechazó el link: 404 o 400 → no válido; 410
 * según el código; cualquier otro, un error para reintentar.
 */
export function avisoDelLink(status: number, codigo?: string): AvisoLink {
  if (status === 404 || status === 400 || status === 403) {
    return AVISO_LINK_INVALIDO;
  }
  if (status === 410) {
    if (codigo === CODIGO_LINK_VENCIDO) return AVISO_LINK_VENCIDO;
    if (codigo === CODIGO_LINK_CANCELADO) return AVISO_LINK_CANCELADO;
    if (codigo === CODIGO_LINK_CADUCADO) return AVISO_LINK_CADUCADO;
    return AVISO_LINK_REEMPLAZADO;
  }
  return AVISO_LINK_ERROR;
}

/** Las líneas del resumen, con el formato que usa PagoPedido. */
export function lineasParaPagar(resumen: ResumenLinkPago) {
  return resumen.lineas.map((l) => ({
    itemCartaId: l.itemCartaId,
    nombre: l.nombre,
    cantidad: l.cantidad,
    precio: Number(l.precio),
  }));
}

/** El pedido ya se pagó (o está en cocina, listo o entregado). */
export function yaEstaPagado(resumen: Pick<ResumenLinkPago, "estadoPedido">) {
  return resumen.estadoPedido !== "PENDIENTE_PAGO";
}
