// El `external_reference` de la order de Mercado Pago lleva el tenant y el
// pedido, así el webhook (que no tiene JWT ni tenant) sabe a qué restaurante
// pertenece el pago SIN consultar entre tenants (RLS).
//
// Formato: "v1" + tenantId + pedidoId, cada UUID como 16 bytes en base64url
// (22 caracteres) => 46 caracteres. Mercado Pago admite hasta 64, y solo
// letras, números, guiones y guiones bajos: base64url cumple todo eso.
const VERSION = 'v1';
const LARGO_UUID_B64 = 22;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidABase64Url(uuid: string): string {
  return Buffer.from(uuid.replaceAll('-', ''), 'hex').toString('base64url');
}

function base64UrlAUuid(texto: string): string | null {
  const bytes = Buffer.from(texto, 'base64url');
  if (bytes.length !== 16) return null;
  const hex = bytes.toString('hex');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID_REGEX.test(uuid) ? uuid : null;
}

export function armarReferenciaExterna(
  tenantId: string,
  pedidoId: string,
): string {
  if (!UUID_REGEX.test(tenantId) || !UUID_REGEX.test(pedidoId)) {
    throw new Error('tenantId y pedidoId deben ser UUID');
  }
  return `${VERSION}${uuidABase64Url(tenantId)}${uuidABase64Url(pedidoId)}`;
}

export function leerReferenciaExterna(
  referencia?: string,
): { tenantId: string; pedidoId: string } | null {
  if (
    referencia?.length !== VERSION.length + LARGO_UUID_B64 * 2 ||
    !referencia.startsWith(VERSION)
  ) {
    return null;
  }
  const cuerpo = referencia.slice(VERSION.length);
  const tenantId = base64UrlAUuid(cuerpo.slice(0, LARGO_UUID_B64));
  const pedidoId = base64UrlAUuid(cuerpo.slice(LARGO_UUID_B64));
  return tenantId && pedidoId ? { tenantId, pedidoId } : null;
}
