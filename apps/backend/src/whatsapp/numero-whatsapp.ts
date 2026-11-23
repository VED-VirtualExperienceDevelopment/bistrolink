/**
 * HU-010 (BL-613): número de WhatsApp del bot de un local, el que el menú
 * para retirar ofrece como «¿Preferís pedir por WhatsApp?».
 *
 * Se guarda en formato internacional con «+» (E.164: «+59899123456»). El
 * administrador lo puede escribir como lo conoce: un celular uruguayo
 * («099 123 456», «99123456») o un número internacional con «+». Lo que no
 * se puede leer queda como lo escribió y no pasa la validación.
 */
export const NUMERO_WHATSAPP = /^\+[1-9]\d{7,14}$/;

const CELULAR_URUGUAYO = /^0?9\d{7}$/;
const URUGUAYO_CON_PREFIJO = /^598\d{8}$/;

/** «099 123 456» → «+59899123456». Vacío → null (quitarlo). */
export function normalizarNumeroWhatsapp(valor: string): string | null {
  const limpio = valor.trim();
  if (limpio === '') return null;
  const sinSeparadores = limpio.replaceAll(/[\s().-]/g, '');
  if (sinSeparadores.startsWith('+')) return sinSeparadores;
  if (CELULAR_URUGUAYO.test(sinSeparadores)) {
    return `+598${sinSeparadores.replace(/^0/, '')}`;
  }
  if (URUGUAYO_CON_PREFIJO.test(sinSeparadores)) return `+${sinSeparadores}`;
  return limpio;
}

/** «+59899123456» → «59899123456», como lo pide wa.me. */
export function numeroParaWaMe(numero: string): string {
  return numero.replace(/^\+/, '');
}
