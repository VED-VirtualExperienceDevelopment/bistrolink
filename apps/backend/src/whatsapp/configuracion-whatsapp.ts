import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HU-010 (BL-112): configuración del bot de WhatsApp, leída del entorno.
 *
 * El bot está apagado si falta cualquiera de las variables: el webhook
 * responde 401 a todo y no se manda nada. Ninguna de estas variables va al
 * repo: en staging se cargan en Railway.
 *
 * - EVOLUTION_API_URL: dirección de Evolution API (sin barra final).
 * - EVOLUTION_API_KEY: la API key global de Evolution (header `apikey`).
 * - EVOLUTION_INSTANCIAS: qué tenant atiende cada instancia, como
 *   `instancia=tenantId`, separadas por coma. Un tenant tiene un solo
 *   restaurante, así que con el tenant alcanza.
 * - WHATSAPP_WEBHOOK_SECRETO: lo manda Evolution en el header
 *   `x-bistrolink-webhook-secreto` de cada evento (al menos 32 caracteres).
 * - WHATSAPP_TELEFONO_CLAVE: clave del HMAC con el que se guarda el
 *   teléfono en la conversación (al menos 32 caracteres). Así la base no
 *   tiene el número en claro.
 */

export const HEADER_SECRETO_WEBHOOK = 'x-bistrolink-webhook-secreto';
export const LARGO_MINIMO_SECRETO = 32;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOMBRE_INSTANCIA = /^[A-Za-z0-9_-]{1,64}$/;

export interface ConfiguracionWhatsapp {
  evolutionUrl: string;
  evolutionApiKey: string;
  /** instancia → tenantId */
  instancias: ReadonlyMap<string, string>;
  secretoWebhook: string;
  claveTelefono: string;
}

/**
 * «a=uuid,b=uuid» → Map. Descarta las entradas mal formadas (nombre de
 * instancia raro o tenant que no es un UUID).
 */
export function leerInstancias(valor: string | undefined): Map<string, string> {
  const instancias = new Map<string, string>();
  for (const par of (valor ?? '').split(',')) {
    const [nombre, tenantId, ...resto] = par.split('=').map((p) => p.trim());
    if (
      resto.length === 0 &&
      nombre &&
      tenantId &&
      NOMBRE_INSTANCIA.test(nombre) &&
      UUID.test(tenantId)
    ) {
      instancias.set(nombre, tenantId.toLowerCase());
    }
  }
  return instancias;
}

/** La configuración, o null si el bot está apagado (falta algo). */
export function configuracionWhatsapp(
  env: NodeJS.ProcessEnv,
): ConfiguracionWhatsapp | null {
  const evolutionUrl = env.EVOLUTION_API_URL?.trim().replace(/\/+$/, '');
  const evolutionApiKey = env.EVOLUTION_API_KEY?.trim();
  const secretoWebhook = env.WHATSAPP_WEBHOOK_SECRETO ?? '';
  const claveTelefono = env.WHATSAPP_TELEFONO_CLAVE ?? '';
  const instancias = leerInstancias(env.EVOLUTION_INSTANCIAS);
  if (
    !evolutionUrl ||
    !/^https?:\/\//.test(evolutionUrl) ||
    !evolutionApiKey ||
    instancias.size === 0 ||
    secretoWebhook.length < LARGO_MINIMO_SECRETO ||
    claveTelefono.length < LARGO_MINIMO_SECRETO
  ) {
    return null;
  }
  return {
    evolutionUrl,
    evolutionApiKey,
    instancias,
    secretoWebhook,
    claveTelefono,
  };
}

/**
 * Compara el secreto del header con el configurado en tiempo constante
 * (sobre los hashes, que tienen el mismo largo aunque los textos no).
 */
export function secretoWebhookValido(
  recibido: string | undefined,
  esperado: string | undefined,
): boolean {
  if (!recibido || !esperado) return false;
  const a = createHash('sha256').update(recibido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

/**
 * El teléfono como se guarda en la conversación: HMAC-SHA256 del tenant y
 * el número. El mismo número en dos locales da dos hashes distintos.
 */
export function hashTelefono(
  clave: string,
  tenantId: string,
  telefono: string,
): string {
  return createHmac('sha256', clave)
    .update(`${tenantId}:${telefono}`)
    .digest('hex');
}
