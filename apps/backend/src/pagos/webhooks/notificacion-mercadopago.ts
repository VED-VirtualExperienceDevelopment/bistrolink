// BL-215: qué datos de una notificación de Mercado Pago usa BistroLink.
// Se extrajo del controller para que el contrato del webhook (message pact)
// pruebe exactamente el mismo código que procesa las notificaciones reales.
//
// Mercado Pago manda el tipo de evento y el id del recurso tanto en la query
// (?type=order&data.id=ORD...) como en el cuerpo ({ type, data: { id } }).
// La query tiene prioridad porque es la que entra en el manifiesto de la
// firma (ver firma-webhook-mercadopago.ts). Del cuerpo no se usa nada más:
// el estado real de la order se consulta después a Mercado Pago.

export interface QueryNotificacion {
  type?: string;
  'data.id'?: string;
}

export interface CuerpoNotificacion {
  type?: string;
  data?: { id?: string };
}

/**
 * Devuelve el id de la order notificada, o null si la notificación no es de
 * una order (otro tipo de evento, que se confirma con 200 y se ignora).
 */
export function leerNotificacionOrden(
  query: QueryNotificacion | undefined,
  cuerpo: CuerpoNotificacion | undefined,
): string | null {
  const tipo = query?.type ?? cuerpo?.type;
  const orderId = query?.['data.id'] ?? cuerpo?.data?.id;
  if (tipo !== 'order' || !orderId) {
    return null;
  }
  return orderId;
}
