/**
 * BL-309: de dónde sale el token del comensal y a qué origen va el pedido,
 * según el menú sea de una mesa (QR) o del link web del local.
 *
 * Lógica pura, separada de MenuDigital.tsx para poder testearla: el bug de
 * BL-309 fue una ruta de auth que no existía en el backend
 * (/auth/comensal/mesa) y que ningún test cubría.
 */

export type TipoMenu = 'mesa' | 'publico';

/** Ruta del backend que emite el token del comensal (AuthComensalController). */
export const RUTA_AUTH_COMENSAL = '/auth/comensal';

export type CuerpoAuthComensal =
  | { tenantId: string; mesaId: string }
  | { tenantId: string; restauranteId: string };

export interface SolicitudAuthComensal {
  ruta: typeof RUTA_AUTH_COMENSAL;
  body: CuerpoAuthComensal;
}

/**
 * Mesa y link web usan la misma ruta: el body distingue el caso (mesaId o
 * restauranteId), igual que valida EmitirTokenComensalDto en el backend.
 */
export function solicitudAuthComensal(
  tipo: TipoMenu,
  tenantId: string,
  idOrigen: string,
): SolicitudAuthComensal {
  return {
    ruta: RUTA_AUTH_COMENSAL,
    body:
      tipo === 'mesa'
        ? { tenantId, mesaId: idOrigen }
        : { tenantId, restauranteId: idOrigen },
  };
}

/** Campo de origen del body de POST /pedidos: la mesa o el restaurante. */
export function origenPedido(
  tipo: TipoMenu,
  idOrigen: string,
): { mesaId: string } | { restauranteId: string } {
  return tipo === 'mesa' ? { mesaId: idOrigen } : { restauranteId: idOrigen };
}