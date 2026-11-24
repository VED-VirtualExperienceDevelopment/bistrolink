import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * HU-033 (BL-203): token del link de pago (/pagar/<token>).
 *
 * Cifra { tenantId, pedidoId, nonce } con AES-256-GCM, igual que el QR de
 * las mesas (HU-034):
 * - Opaco: la URL no muestra IDs internos ni datos del comensal.
 * - Infalsificable: GCM autentica el contenido; cualquier cambio en el token
 *   hace fallar el descifrado.
 * - Único: el nonce y el IV son aleatorios, así que cada link es distinto.
 *
 * El pedido guarda solo el SHA-256 del nonce del link vigente
 * (`pedido.link_pago_hash`): generar otro link lo reemplaza y el anterior
 * deja de servir, aunque se pueda descifrar.
 *
 * La clave sale de QR_TOKEN_KEY con HKDF y otro `info`: es independiente de
 * la del QR, y AAD propio impide usar un token de QR como link (y al revés).
 *
 * Formato (77 bytes, base64url → 103 caracteres):
 *   [formato 1 byte][iv 12 bytes][datos cifrados 48 bytes][tag 16 bytes]
 *   datos = tenantId (16 bytes) + pedidoId (16 bytes) + nonce (16 bytes)
 */
export interface DatosLinkPago {
  tenantId: string;
  pedidoId: string;
  /** Nonce en base64url; su SHA-256 es el que se guarda en el pedido. */
  nonce: string;
}

const FORMATO_V1 = 0x01;
const LARGO_CLAVE = 32;
const LARGO_IV = 12;
const LARGO_TAG = 16;
const LARGO_UUID = 16;
const LARGO_NONCE = 16;
const LARGO_DATOS = LARGO_UUID * 2 + LARGO_NONCE;
const LARGO_TOKEN = 1 + LARGO_IV + LARGO_DATOS + LARGO_TAG;
// Un token válido tiene 103 caracteres; el margen evita procesar entradas
// enormes antes de rechazarlas.
export const LARGO_MAXIMO_TOKEN_LINK = 128;
const AAD = Buffer.from('bistrolink:link-pago:v1');
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

let claveCacheada: Buffer | null = null;

/** Lazy: la app levanta aunque falte la clave; falla recién al usarla. */
function clave(): Buffer {
  if (!claveCacheada) {
    const valor = process.env.QR_TOKEN_KEY;
    if (!valor) {
      throw new Error('Falta QR_TOKEN_KEY en el entorno');
    }
    const maestra = Buffer.from(valor, 'base64');
    if (maestra.length !== LARGO_CLAVE) {
      throw new Error('QR_TOKEN_KEY debe ser una clave de 32 bytes en base64');
    }
    claveCacheada = Buffer.from(
      hkdfSync(
        'sha256',
        maestra,
        Buffer.alloc(0),
        'bistrolink:link-pago:cifrado',
        32,
      ),
    );
  }
  return claveCacheada;
}

/** Solo para los tests que cambian QR_TOKEN_KEY. */
export function olvidarClaveLinkPago(): void {
  claveCacheada = null;
}

function uuidABytes(uuid: string): Buffer {
  if (!UUID_REGEX.test(uuid)) {
    throw new Error('El link de pago requiere ids con formato UUID');
  }
  return Buffer.from(uuid.replaceAll('-', ''), 'hex');
}

function bytesAUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/** Un link nuevo: el token para la URL y el hash del nonce para el pedido. */
export function nuevoLinkPago(
  tenantId: string,
  pedidoId: string,
): { token: string; hash: string } {
  const nonce = randomBytes(LARGO_NONCE);
  const plano = Buffer.concat([
    uuidABytes(tenantId),
    uuidABytes(pedidoId),
    nonce,
  ]);
  const iv = randomBytes(LARGO_IV);
  const cipher = createCipheriv('aes-256-gcm', clave(), iv);
  cipher.setAAD(AAD);
  const cifrado = Buffer.concat([cipher.update(plano), cipher.final()]);
  const token = Buffer.concat([
    Buffer.from([FORMATO_V1]),
    iv,
    cifrado,
    cipher.getAuthTag(),
  ]).toString('base64url');
  return { token, hash: hashNonceLinkPago(nonce.toString('base64url')) };
}

/**
 * Los datos del token, o null si no es un link válido. No distingue el
 * motivo (formato, largo o firma), para no dar pistas a quien prueba tokens.
 */
export function leerLinkPago(token: unknown): DatosLinkPago | null {
  if (
    typeof token !== 'string' ||
    token.length > LARGO_MAXIMO_TOKEN_LINK ||
    !BASE64URL_REGEX.test(token)
  ) {
    return null;
  }
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length !== LARGO_TOKEN || bytes[0] !== FORMATO_V1) {
    return null;
  }
  const iv = bytes.subarray(1, 1 + LARGO_IV);
  const cifrado = bytes.subarray(1 + LARGO_IV, 1 + LARGO_IV + LARGO_DATOS);
  const tag = bytes.subarray(LARGO_TOKEN - LARGO_TAG);
  try {
    const decipher = createDecipheriv('aes-256-gcm', clave(), iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plano = Buffer.concat([decipher.update(cifrado), decipher.final()]);
    return {
      tenantId: bytesAUuid(plano.subarray(0, LARGO_UUID)),
      pedidoId: bytesAUuid(plano.subarray(LARGO_UUID, LARGO_UUID * 2)),
      nonce: plano.subarray(LARGO_UUID * 2).toString('base64url'),
    };
  } catch {
    return null;
  }
}

export function hashNonceLinkPago(nonce: string): string {
  return createHash('sha256').update(nonce, 'utf8').digest('hex');
}

/** Comparación en tiempo constante, para no filtrar el hash por timing. */
export function nonceCoincide(
  nonce: string,
  hashGuardado: string | null,
): boolean {
  if (!hashGuardado) return false;
  const recibido = Buffer.from(hashNonceLinkPago(nonce), 'hex');
  const guardado = Buffer.from(hashGuardado, 'hex');
  return (
    recibido.length === guardado.length && timingSafeEqual(recibido, guardado)
  );
}
