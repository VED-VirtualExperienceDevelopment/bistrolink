/**
 * HU-010 (BL-613): el número del bot de WhatsApp del local y el enlace
 * «¿Preferís pedir por WhatsApp?» del menú para retirar.
 *
 * Lógica pura, con test (test/unitarios/whatsapp.utils.spec.ts). El backend
 * normaliza y valida igual (src/whatsapp/numero-whatsapp.ts): esto solo
 * evita mandar algo que se va a rechazar.
 */
import type { RetiroPublico } from "./retiro.utils";

/** Formato internacional E.164 con «+», como lo guarda el backend. */
const NUMERO_WHATSAPP = /^\+[1-9]\d{7,14}$/;
const CELULAR_URUGUAYO = /^0?9\d{7}$/;
const URUGUAYO_CON_PREFIJO = /^598\d{8}$/;

/** Mensaje que queda escrito al abrir el chat (el bot arranca con cualquiera). */
// BL-613: el bot muestra la carta con cualquier mensaje que empiece con un
// saludo (conversacion.ts), así que este texto sirve también para quien
// vuelve a entrar por el enlace.
const MENSAJE_INICIAL_WHATSAPP = "Hola, me gustaría hacer un pedido.";

/**
 * «099 123 456» → «+59899123456». Vacío → null (quitarlo). Lo que no se
 * puede leer queda como está (y errorNumeroWhatsapp lo marca).
 */
export function normalizarNumeroWhatsapp(texto: string): string | null {
  const limpio = texto.trim();
  if (limpio === "") return null;
  const sinSeparadores = limpio.replaceAll(/[\s().-]/g, "");
  if (sinSeparadores.startsWith("+")) return sinSeparadores;
  if (CELULAR_URUGUAYO.test(sinSeparadores)) {
    return `+598${sinSeparadores.replace(/^0/, "")}`;
  }
  if (URUGUAYO_CON_PREFIJO.test(sinSeparadores)) return `+${sinSeparadores}`;
  return limpio;
}

/** Error del número, o null si está bien (vacío vale: no se ofrece). */
export function errorNumeroWhatsapp(texto: string): string | null {
  const numero = normalizarNumeroWhatsapp(texto);
  if (numero === null || NUMERO_WHATSAPP.test(numero)) return null;
  return "Escribí un celular uruguayo (099 123 456) o un número internacional que empiece con +.";
}

/** Enlace que abre el chat con el bot y el saludo escrito. */
export function enlacePedirPorWhatsapp(numero: string): string {
  const digitos = numero.replace(/^\+/, "");
  return `https://wa.me/${digitos}?text=${encodeURIComponent(MENSAJE_INICIAL_WHATSAPP)}`;
}

/**
 * Si el menú ofrece «¿Preferís pedir por WhatsApp?»: solo el de retirar
 * (nunca el de la mesa: el bot no toma pedidos de mesa), con un número (el
 * backend lo manda solo si el bot atiende al local) y con el local tomando
 * pedidos para retirar en este momento (el bot tampoco los tomaría).
 */
export function ofrecerPedirPorWhatsapp(
  tipoDeMenu: "mesa" | "publico" | "link",
  numero: string | null | undefined,
  retiro: RetiroPublico | null | undefined,
): numero is string {
  if (tipoDeMenu !== "publico" || !numero) return false;
  // Un backend anterior no manda `retiro`: se puede pedir, como antes.
  return retiro?.abierto ?? true;
}
