/**
 * De dónde sale el token del comensal y a qué origen va el pedido, según el
 * menú sea de una mesa (QR) o del link web del local.
 *
 * Lógica pura, separada de MenuDigital.tsx y LlamarMozoButton.tsx para poder
 * testearla: el bug de BL-309 fue una ruta de auth que no existía en el
 * backend y que ningún test cubría.
 *
 * HU-034 (BL-204): en la mesa, el frontend ya no conoce ningún id. Solo
 * tiene el token opaco del QR (/q/<token>), que manda:
 * - en el body de POST /auth/comensal/mesa, para obtener el JWT del comensal;
 * - en el header X-Mesa-Token de POST /pedidos y POST /mesas/llamar, para que
 *   el backend sepa de qué mesa es (MesaQrGuard), sin confiar en el cliente.
 */

export type OrigenMenu =
  | { readonly tipo: "mesa"; readonly qrToken: string }
  | {
      readonly tipo: "publico";
      readonly tenantId: string;
      readonly restauranteId: string;
    };

export type TipoMenu = OrigenMenu["tipo"];

/** Rutas del backend (AuthComensalController / MesasController). */
export const RUTA_AUTH_COMENSAL = "/auth/comensal";
export const RUTA_AUTH_COMENSAL_MESA = "/auth/comensal/mesa";
export const RUTA_LLAMAR_MOZO = "/mesas/llamar";

/** Header con el token del QR (HEADER_MESA_TOKEN en el backend). */
export const HEADER_MESA_TOKEN = "X-Mesa-Token";

/** Mismos textos que QrMesaAccesoService en el backend. */
export const MENSAJE_QR_INVALIDO =
  "Este QR no es válido. Escaneá de nuevo el código de tu mesa.";
export const MENSAJE_QR_REEMPLAZADO =
  "Este QR fue reemplazado. Pedile al personal el QR actualizado de la mesa.";

/**
 * Formato del token del QR: base64url, como lo genera QrMesaTokenService
 * (87 caracteres hoy; el tope de 128 es el mismo del DTO del backend).
 * Se valida antes de armar cualquier URL con él.
 */
const FORMATO_TOKEN_QR = /^[A-Za-z0-9_-]{1,128}$/;

export function esTokenQrConFormatoValido(token: string): boolean {
  return FORMATO_TOKEN_QR.test(token);
}

export type CuerpoAuthComensal =
  { qrToken: string } | { tenantId: string; restauranteId: string };

export interface SolicitudAuthComensal {
  ruta: typeof RUTA_AUTH_COMENSAL | typeof RUTA_AUTH_COMENSAL_MESA;
  body: CuerpoAuthComensal;
}

/** Ruta y body para pedir el JWT del comensal. */
export function solicitudAuthComensal(
  origen: OrigenMenu,
): SolicitudAuthComensal {
  if (origen.tipo === "mesa") {
    return {
      ruta: RUTA_AUTH_COMENSAL_MESA,
      body: { qrToken: origen.qrToken },
    };
  }
  return {
    ruta: RUTA_AUTH_COMENSAL,
    body: { tenantId: origen.tenantId, restauranteId: origen.restauranteId },
  };
}

/**
 * Campo de origen del body de POST /pedidos. En la mesa va vacío: la mesa
 * (y su restaurante) salen del X-Mesa-Token, del lado del servidor.
 */
export function origenPedido(
  origen: OrigenMenu,
): { restauranteId: string } | Record<string, never> {
  return origen.tipo === "mesa" ? {} : { restauranteId: origen.restauranteId };
}

/** Header X-Mesa-Token para pedidos y llamados desde la mesa. */
export function headersMesaQr(origen: OrigenMenu): Record<string, string> {
  return origen.tipo === "mesa" ? { [HEADER_MESA_TOKEN]: origen.qrToken } : {};
}

/**
 * Mensaje para el comensal si el backend rechazó el QR de la mesa: 410 (se
 * regeneró) o 404 (no válido). null en cualquier otro caso, o si el menú no
 * es de una mesa (en el link web un 404 no tiene que ver con un QR).
 */
export function mensajeErrorQr(
  origen: OrigenMenu,
  status: number,
): string | null {
  if (origen.tipo !== "mesa") return null;
  if (status === 410) return MENSAJE_QR_REEMPLAZADO;
  if (status === 404) return MENSAJE_QR_INVALIDO;
  return null;
}

/** Etiqueta del encabezado del menú de mesa. */
export function etiquetaMesa(numeroMesa?: number): string {
  return numeroMesa ? `Mesa ${numeroMesa}` : "Mesa asignada";
}

/**
 * BL-425: tope de unidades de un mismo ítem en el carrito. Mismo valor que
 * CANTIDAD_MAXIMA_POR_ITEM en crear-pedido.dto.ts (backend).
 */
export const CANTIDAD_MAXIMA_POR_ITEM = 99;

/** Cantidad después de sumar una unidad, sin pasar del tope. */
export function sumarUnidad(cantidad: number): number {
  return Math.min(cantidad + 1, CANTIDAD_MAXIMA_POR_ITEM);
}

/** true si el ítem ya llegó al tope de unidades y no se puede agregar otra. */
export function alcanzoCantidadMaxima(cantidad: number): boolean {
  return cantidad >= CANTIDAD_MAXIMA_POR_ITEM;
}
