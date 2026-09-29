import { createHmac, timingSafeEqual } from 'node:crypto';

export interface DatosFirmaWebhook {
  /** Header `x-signature`: "ts=1742505638683,v1=ced36ab6..." */
  xSignature?: string;
  /** Header `x-request-id` */
  xRequestId?: string;
  /** Query param `data.id` (el id de la order notificada) */
  dataId?: string;
  /** Clave secreta del webhook (Tus integraciones > Webhooks) */
  secret?: string;
}

// BL-78: verificación de la firma HMAC-SHA256 de las notificaciones de
// Mercado Pago, según su documentación oficial:
//   manifiesto = "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
//   firma      = HMAC-SHA256(secret, manifiesto) en hexadecimal
// - Los pares que no llegan se omiten del manifiesto.
// - data.id se usa en MINÚSCULAS aunque la notificación lo traiga en
//   mayúsculas (los ids de order, ORD..., son alfanuméricos).
// Falla cerrado: sin secret o con cualquier dato faltante, es inválida.
export function firmaWebhookMercadoPagoValida({
  xSignature,
  xRequestId,
  dataId,
  secret,
}: DatosFirmaWebhook): boolean {
  if (!secret || !xSignature) {
    return false;
  }

  let ts: string | undefined;
  let v1: string | undefined;
  for (const parte of xSignature.split(',')) {
    const [clave, ...resto] = parte.split('=');
    const valor = resto.join('=').trim();
    if (clave.trim() === 'ts') ts = valor;
    if (clave.trim() === 'v1') v1 = valor;
  }
  if (!ts || !v1) {
    return false;
  }

  const partes: string[] = [];
  if (dataId) partes.push(`id:${dataId.toLowerCase()}`);
  if (xRequestId) partes.push(`request-id:${xRequestId}`);
  partes.push(`ts:${ts}`);
  const manifiesto = `${partes.join(';')};`;

  const esperada = Buffer.from(
    createHmac('sha256', secret).update(manifiesto).digest('hex'),
  );
  const recibida = Buffer.from(v1.toLowerCase());

  // Comparación en tiempo constante (evita ataques por temporización).
  return (
    esperada.length === recibida.length && timingSafeEqual(esperada, recibida)
  );
}
