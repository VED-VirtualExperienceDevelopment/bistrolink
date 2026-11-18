import { ForbiddenException } from '@nestjs/common';
import type { PedidoCanal } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { leerLinkPago } from '../link-pago/link-pago-token';
import type { CanalInvitado } from './token-invitado';

/**
 * HU-052 (BL-580): el token de invitado solo sirve en el canal por el que se
 * emitió. Las reglas de la mesa están en MesaQrGuard y las de un pedido que
 * ya existe, en PedidoAccesoGuard. Acá van las de los dos endpoints del
 * comensal que no tienen ni mesa ni pedido en la ruta, y la del socket.
 *
 * Con el token de Keycloak (sin `canal`) no hacen nada.
 */

export const MENSAJE_LINK_NO_HACE_PEDIDOS =
  'El link de pago no sirve para hacer pedidos';
export const MENSAJE_RETIRO_DE_OTRO_RESTAURANTE =
  'Este acceso es de otro restaurante';
export const MENSAJE_RESUMEN_DE_OTRO_LINK = 'Este acceso no es de este link';

/**
 * POST /pedidos. El token del link de pago no hace pedidos (solo paga el
 * suyo). El del retiro pide solo en su restaurante. El de la mesa ya llega
 * con la mesa del QR atada por MesaQrGuard, y la mesa decide el restaurante.
 */
export function exigirCanalParaPedidoNuevo(
  user: AuthenticatedUser | undefined,
  restauranteId: string | undefined,
): void {
  const canal = user?.canal;
  if (canal?.tipo === 'link') {
    throw new ForbiddenException(MENSAJE_LINK_NO_HACE_PEDIDOS);
  }
  if (
    canal?.tipo === 'retiro' &&
    restauranteId !== undefined &&
    restauranteId !== canal.restauranteId
  ) {
    throw new ForbiddenException(MENSAJE_RETIRO_DE_OTRO_RESTAURANTE);
  }
}

/**
 * GET /link-pago (resumen antes de pagar). Solo con el token de ese mismo
 * link: el del link de otro pedido, el de una mesa o el del retiro → 403.
 */
export function exigirCanalParaResumenDelLink(
  user: AuthenticatedUser | undefined,
  linkToken: string,
): void {
  const canal = user?.canal;
  if (!canal) return;
  if (
    canal.tipo !== 'link' ||
    leerLinkPago(linkToken)?.pedidoId !== canal.pedidoId
  ) {
    throw new ForbiddenException(MENSAJE_RESUMEN_DE_OTRO_LINK);
  }
}

/** Lo que hace falta de un pedido para saber si un canal lo puede seguir. */
export interface AccesoDelPedido {
  mesaId: string;
  restauranteId: string;
  canal: PedidoCanal;
}

/**
 * Socket `pedido:seguir` (estado del pedido en vivo). Las mismas reglas que
 * PedidoAccesoGuard: el link, su pedido; la mesa, los pedidos de su mesa;
 * el retiro, los pedidos para retirar de su restaurante. Sin canal (token
 * de Keycloak), como antes: alcanza con el tenant.
 */
export function canalPuedeSeguirPedido(
  canal: CanalInvitado | undefined,
  pedidoId: string,
  pedido: AccesoDelPedido,
): boolean {
  if (!canal) return true;
  switch (canal.tipo) {
    case 'link':
      return canal.pedidoId === pedidoId;
    case 'mesa':
      return pedido.canal === 'QR' && pedido.mesaId === canal.mesaId;
    case 'retiro':
      return (
        pedido.canal !== 'QR' && pedido.restauranteId === canal.restauranteId
      );
  }
}
