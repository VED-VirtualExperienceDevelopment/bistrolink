import type { OrigenMenu } from "@/components/menu-digital.utils";
import type { CategoriaMenu } from "@/components/MenuDigital";

/**
 * BL-570: la carta del comensal se carga una vez, al abrirse. Si después un
 * plato se agota o se repone, se vuelve a pedir en dos momentos:
 * - cuando el comensal vuelve a la pestaña (o desbloquea el celular), si
 *   pasó al menos ESPERA_MINIMA_RECARGA_MS desde la última carga;
 * - cuando la API rechaza el pedido por algo de la carta (un plato agotado,
 *   sin stock suficiente o que ya no está en la carta).
 *
 * El carrito no se toca: solo se reemplazan las categorías que se muestran.
 */

/** No se vuelve a pedir la carta si se cargó hace menos de 30 segundos. */
export const ESPERA_MINIMA_RECARGA_MS = 30_000;

/**
 * Ruta de la API con la carta vigente: la misma que usa la página al
 * abrirse. Pago por link no muestra la carta: null.
 */
export function rutaCartaVigente(origen: OrigenMenu): string | null {
  if (origen.tipo === "mesa") {
    return `/menu/qr/${encodeURIComponent(origen.qrToken)}`;
  }
  if (origen.tipo === "publico") {
    return `/menu/tenant/${origen.tenantId}/restaurante/${origen.restauranteId}`;
  }
  return null;
}

/** Al volver a la pestaña: solo si está visible y pasó la espera mínima. */
export function debeRecargarAlVolver(
  visible: boolean,
  ultimaCarga: number,
  ahora: number,
  espera: number = ESPERA_MINIMA_RECARGA_MS,
): boolean {
  return visible && ahora - ultimaCarga >= espera;
}

/**
 * Mensajes de la API cuando el pedido trae algo que la carta ya no ofrece
 * (`pedidos.service.ts` y `stock/estado-stock.ts`):
 * - «"Pizza" no está disponible» (400);
 * - «"Pizza" está agotado» o «No hay stock suficiente de "Pizza": quedan 2»
 *   (409);
 * - «El ítem … no existe en la carta de este restaurante» (400: archivado o
 *   de una categoría oculta).
 */
const MENSAJES_DE_LA_CARTA =
  /no está disponible|está agotado|No hay stock suficiente|no existe en la carta/;

/**
 * El pedido se rechazó por algo de la carta que el comensal no veía. Los
 * errores con código (mesa cerrada, retiro cerrado, local suspendido) tienen
 * su propio aviso y no cambian la carta; los demás 400 (datos del pedido)
 * tampoco.
 */
export function esRechazoPorLaCarta(
  status: number,
  mensaje: string,
  codigo?: string,
): boolean {
  if (codigo !== undefined) return false;
  if (status !== 400 && status !== 409) return false;
  return MENSAJES_DE_LA_CARTA.test(mensaje);
}

/**
 * El aviso del rechazo, con lo que tiene que hacer el comensal. El mensaje
 * de un plato que ya no está en la carta trae su id: se cambia por uno sin
 * datos internos.
 */
export function conAvisoDeCartaActualizada(mensaje: string): string {
  const motivo = /no existe en la carta/.test(mensaje)
    ? "Un plato de tu pedido ya no está en la carta"
    : mensaje;
  return `${motivo}. Actualizamos la carta: revisá tu pedido y sacá lo que ya no está disponible.`;
}

/**
 * Las categorías de la respuesta de la API, o null si la respuesta no tiene
 * la forma esperada (en ese caso queda la carta que se estaba viendo).
 */
export function categoriasDeRespuesta(cuerpo: unknown): CategoriaMenu[] | null {
  if (typeof cuerpo !== "object" || cuerpo === null) return null;
  const categorias = (cuerpo as { categorias?: unknown }).categorias;
  if (!Array.isArray(categorias)) return null;
  const valida = categorias.every(
    (c) =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as { id?: unknown }).id === "string" &&
      Array.isArray((c as { items?: unknown }).items),
  );
  return valida ? (categorias as CategoriaMenu[]) : null;
}
