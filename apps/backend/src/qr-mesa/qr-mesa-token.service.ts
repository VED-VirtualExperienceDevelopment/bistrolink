import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
} from 'node:crypto';

/**
 * HU-034 (BL-204): token opaco de la URL del QR de cada mesa (/q/<token>).
 *
 * El token cifra { tenantId, mesaId, version } con AES-256-GCM:
 * - Opaco: no se pueden leer los IDs internos desde la URL impresa.
 * - Infalsificable: GCM autentica el contenido; cualquier cambio en el token
 *   hace fallar el descifrado.
 * - Determinístico: misma mesa + misma versión = mismo token, así el PDF se
 *   puede descargar varias veces y el QR impreso no cambia. Regenerar el QR
 *   (version + 1) produce otro token. El IV se deriva con HMAC de los datos
 *   ("IV sintético"), con una subclave distinta de la de cifrado.
 *
 * Este servicio solo cifra y descifra. Validar que la versión siga vigente
 * (comparándola con mesa.qr_version) lo hace quien lo usa, dentro del
 * contexto del tenant.
 *
 * Formato (65 bytes, base64url → 87 caracteres):
 *   [formato 1 byte][iv 12 bytes][datos cifrados 36 bytes][tag 16 bytes]
 *   datos = tenantId (16 bytes) + mesaId (16 bytes) + version (uint32 BE)
 *
 * IMPORTANTE: cambiar QR_TOKEN_KEY invalida todos los QR impresos.
 */
export interface DatosTokenQrMesa {
  tenantId: string;
  mesaId: string;
  version: number;
}

const FORMATO_V1 = 0x01;
const LARGO_CLAVE = 32;
const LARGO_IV = 12;
const LARGO_TAG = 16;
const LARGO_UUID = 16;
const LARGO_DATOS = LARGO_UUID * 2 + 4;
const LARGO_TOKEN = 1 + LARGO_IV + LARGO_DATOS + LARGO_TAG;
// Un token válido tiene 87 caracteres; el margen evita procesar entradas
// enormes antes de rechazarlas.
const LARGO_MAXIMO_TEXTO = 128;
const VERSION_MAXIMA = 0xffffffff;

// Datos asociados (AAD): atan el token a este uso. Un texto cifrado con la
// misma clave para otro propósito no se aceptaría como token de QR.
const AAD = Buffer.from('bistrolink:qr-mesa:v1');

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

interface Subclaves {
  cifrado: Buffer;
  iv: Buffer;
}

function uuidABytes(uuid: string): Buffer {
  if (!UUID_REGEX.test(uuid)) {
    throw new Error('El token de QR requiere ids con formato UUID');
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

@Injectable()
export class QrMesaTokenService {
  // Lazy, igual que StorageService: la app levanta aunque falte la clave;
  // falla recién cuando se usa una funcionalidad de QR.
  private subclaves: Subclaves | null = null;

  private obtenerSubclaves(): Subclaves {
    if (!this.subclaves) {
      const valor = process.env.QR_TOKEN_KEY;
      if (!valor) {
        throw new Error('Falta QR_TOKEN_KEY en el entorno');
      }
      const maestra = Buffer.from(valor, 'base64');
      if (maestra.length !== LARGO_CLAVE) {
        throw new Error(
          'QR_TOKEN_KEY debe ser una clave de 32 bytes en base64',
        );
      }
      // Subclaves independientes para cifrar y para derivar el IV: nunca se
      // usa la misma clave para dos funciones criptográficas distintas.
      const sal = Buffer.alloc(0);
      this.subclaves = {
        cifrado: Buffer.from(
          hkdfSync('sha256', maestra, sal, 'bistrolink:qr-mesa:cifrado', 32),
        ),
        iv: Buffer.from(
          hkdfSync('sha256', maestra, sal, 'bistrolink:qr-mesa:iv', 32),
        ),
      };
    }
    return this.subclaves;
  }

  cifrar(datos: DatosTokenQrMesa): string {
    if (
      !Number.isInteger(datos.version) ||
      datos.version < 1 ||
      datos.version > VERSION_MAXIMA
    ) {
      throw new Error('La versión del QR debe ser un entero positivo');
    }

    const claves = this.obtenerSubclaves();

    const plano = Buffer.alloc(LARGO_DATOS);
    uuidABytes(datos.tenantId).copy(plano, 0);
    uuidABytes(datos.mesaId).copy(plano, LARGO_UUID);
    plano.writeUInt32BE(datos.version, LARGO_UUID * 2);

    // IV sintético: único para cada combinación distinta de datos, y el mismo
    // para los mismos datos (de ahí el token determinístico).
    const iv = createHmac('sha256', claves.iv)
      .update(plano)
      .digest()
      .subarray(0, LARGO_IV);

    const cipher = createCipheriv('aes-256-gcm', claves.cifrado, iv);
    cipher.setAAD(AAD);
    const cifrado = Buffer.concat([cipher.update(plano), cipher.final()]);

    return Buffer.concat([
      Buffer.from([FORMATO_V1]),
      iv,
      cifrado,
      cipher.getAuthTag(),
    ]).toString('base64url');
  }

  /**
   * Devuelve los datos del token, o null si no es un token válido. No
   * distingue el motivo (formato, largo o firma), para no dar pistas a
   * quien prueba tokens.
   */
  descifrar(token: string): DatosTokenQrMesa | null {
    if (
      typeof token !== 'string' ||
      token.length > LARGO_MAXIMO_TEXTO ||
      !BASE64URL_REGEX.test(token)
    ) {
      return null;
    }

    const bytes = Buffer.from(token, 'base64url');
    if (bytes.length !== LARGO_TOKEN || bytes[0] !== FORMATO_V1) {
      return null;
    }

    // Fuera del try: si falta la clave, tiene que fallar fuerte, no
    // confundirse con un token inválido.
    const claves = this.obtenerSubclaves();

    const iv = bytes.subarray(1, 1 + LARGO_IV);
    const cifrado = bytes.subarray(1 + LARGO_IV, 1 + LARGO_IV + LARGO_DATOS);
    const tag = bytes.subarray(LARGO_TOKEN - LARGO_TAG);

    try {
      const decipher = createDecipheriv('aes-256-gcm', claves.cifrado, iv);
      decipher.setAAD(AAD);
      decipher.setAuthTag(tag);
      const plano = Buffer.concat([decipher.update(cifrado), decipher.final()]);

      return {
        tenantId: bytesAUuid(plano.subarray(0, LARGO_UUID)),
        mesaId: bytesAUuid(plano.subarray(LARGO_UUID, LARGO_UUID * 2)),
        version: plano.readUInt32BE(LARGO_UUID * 2),
      };
    } catch {
      return null;
    }
  }
}
