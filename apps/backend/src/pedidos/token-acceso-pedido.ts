import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Header con el token de acceso de un pedido para retirar (canal WEB). */
export const HEADER_PEDIDO_TOKEN = 'x-pedido-token';

/**
 * BL-311 (RD.05): token de acceso de un pedido para retirar.
 *
 * El comensal técnico es el mismo usuario para todo el tenant, así que el
 * JWT no alcanza para saber de quién es un pedido. Los pedidos de mesa se
 * atan con el QR (X-Mesa-Token); los de retiro no tienen QR, así que al
 * crearlos se les da un token propio.
 *
 * 32 bytes aleatorios (256 bits): no hace falta un hash lento como bcrypt,
 * porque no se puede adivinar por fuerza bruta. Se guarda solo el SHA-256.
 */
export function generarTokenAcceso(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashTokenAcceso(token) };
}

export function hashTokenAcceso(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Comparación en tiempo constante, para no filtrar el hash por timing. */
export function tokenAccesoCoincide(
  token: string,
  hashGuardado: string | null,
): boolean {
  if (!hashGuardado) {
    return false;
  }
  const recibido = Buffer.from(hashTokenAcceso(token), 'hex');
  const guardado = Buffer.from(hashGuardado, 'hex');
  return (
    recibido.length === guardado.length && timingSafeEqual(recibido, guardado)
  );
}
