/**
 * HU-010 (BL-112): lo que nos interesa de un evento `messages.upsert` que
 * manda Evolution API (v2.3) al webhook.
 *
 * Solo se procesan los mensajes de texto que escribe una persona en un chat
 * individual. Se descartan, sin responder:
 * - los que manda el propio número del local (`fromMe`), para que el bot no
 *   se conteste a sí mismo;
 * - los de grupos (`@g.us`), estados (`status@broadcast`) y canales;
 * - los que no son texto (audio, imagen, ubicación, reacciones…).
 */

/** Largo máximo del texto que se procesa: el bot espera números cortos. */
export const LARGO_MAXIMO_TEXTO = 200;

export interface MensajeEntrante {
  /** Nombre de la instancia de Evolution (un número de WhatsApp). */
  instancia: string;
  /** Id del mensaje en WhatsApp: sirve para descartar repetidos. */
  mensajeId: string;
  /** Solo dígitos, con el código de país (por ejemplo 598991234567). */
  telefono: string;
  /** Texto recortado y sin espacios de más. */
  texto: string;
}

interface CuerpoEvolution {
  event?: unknown;
  instance?: unknown;
  data?: {
    key?: { remoteJid?: unknown; fromMe?: unknown; id?: unknown };
    message?: {
      conversation?: unknown;
      extendedTextMessage?: { text?: unknown };
    };
  };
}

const SUFIJO_CHAT_INDIVIDUAL = '@s.whatsapp.net';

function textoDelMensaje(cuerpo: CuerpoEvolution): string | null {
  const mensaje = cuerpo.data?.message;
  const texto =
    typeof mensaje?.conversation === 'string'
      ? mensaje.conversation
      : mensaje?.extendedTextMessage?.text;
  if (typeof texto !== 'string') return null;
  const limpio = texto.trim().replaceAll(/\s+/g, ' ');
  return limpio === '' ? null : limpio.slice(0, LARGO_MAXIMO_TEXTO);
}

/** El evento como mensaje para el bot, o null si hay que ignorarlo. */
export function leerMensajeEntrante(cuerpo: unknown): MensajeEntrante | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null;
  const evento = cuerpo as CuerpoEvolution;
  // Evolution manda «messages.upsert»; con WEBHOOK_GLOBAL algunas versiones
  // lo mandan en mayúsculas y con guion bajo.
  const tipo =
    typeof evento.event === 'string'
      ? evento.event.toLowerCase().replace('_', '.')
      : '';
  if (tipo !== 'messages.upsert') return null;
  if (typeof evento.instance !== 'string' || evento.instance === '') {
    return null;
  }

  const clave = evento.data?.key;
  if (clave?.fromMe !== false) return null;
  if (
    typeof clave.id !== 'string' ||
    clave.id === '' ||
    clave.id.length > 128
  ) {
    return null;
  }
  const jid = clave.remoteJid;
  if (typeof jid !== 'string' || !jid.endsWith(SUFIJO_CHAT_INDIVIDUAL)) {
    return null;
  }
  const telefono = jid.slice(0, -SUFIJO_CHAT_INDIVIDUAL.length);
  if (!/^\d{8,15}$/.test(telefono)) return null;

  const texto = textoDelMensaje(evento);
  if (texto === null) return null;

  return {
    instancia: evento.instance,
    mensajeId: clave.id,
    telefono,
    texto,
  };
}

/**
 * El teléfono para los logs: solo los últimos 3 dígitos. Nunca se loguea
 * el número completo (datos personales, Ley 18.331).
 */
export function telefonoParaLog(telefono: string): string {
  return `***${telefono.slice(-3)}`;
}
