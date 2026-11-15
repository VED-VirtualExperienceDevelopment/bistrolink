import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { origenesPermitidos } from '../seguridad-http';
import { WsAuthError, WsAuthService } from '../pedidos/ws-auth.service';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';

/**
 * BL-515: el canal solo lo usa Gestión de Carta, que es del Administrador.
 * La carta del comensal no se suscribe a este namespace.
 */
const ROLES_CANAL_MENU = ['ADMIN'];

/**
 * BL-515: campos del ítem que se mandan en `menu:item:data:updated`. Son los
 * que puede mostrar Gestión de Carta. Quedan afuera el tenant, el stock
 * (`controlaStock`, `stockActual`, `umbralAlerta`), la clave de la imagen y
 * las fechas.
 */
const CAMPOS_ITEM_PARA_PANTALLA = [
  'id',
  'categoriaId',
  'nombre',
  'descripcion',
  'precio',
  'disponible',
  'destacado',
  'sugerible',
  'contieneAlcohol',
  'orden',
] as const;

export function datosItemParaPantalla(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const resultado: Record<string, unknown> = {};
  for (const campo of CAMPOS_ITEM_PARA_PANTALLA) {
    if (campo in data) resultado[campo] = data[campo];
  }
  return resultado;
}

type SocketMenu = Socket & { data: { user?: AuthenticatedUser } };

// Gateway WebSocket para emitir cambios en tiempo real de la carta a
// Gestión de Carta, solo a los administradores del mismo tenant.
@WebSocketGateway({
  // BL-426: la misma lista de orígenes que la API (seguridad-http.ts).
  cors: {
    origin: origenesPermitidos(),
    credentials: true,
  },
  namespace: '/menu',
})
export class MenuGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Namespace;

  private readonly logger = new Logger(MenuGateway.name);

  constructor(private readonly wsAuth: WsAuthService) {}

  /**
   * BL-515: el token se verifica en el handshake, antes de aceptar la
   * conexión, con el mismo servicio que el KDS. Si falla, el cliente recibe
   * `connect_error` y no llega a conectarse. El cliente vuelve a intentar
   * con el token del momento, así que un token vencido se resuelve solo.
   */
  afterInit(server: Namespace) {
    server.use((socket, next) => {
      void this.autenticar(socket as SocketMenu).then(
        () => next(),
        (err: Error) => next(err),
      );
    });
  }

  async autenticar(socket: SocketMenu): Promise<void> {
    const token = socket.handshake.auth?.token as string | undefined;
    let user: AuthenticatedUser;
    try {
      user = await this.wsAuth.verify(token);
    } catch (err) {
      const esWsAuthError =
        err instanceof WsAuthError || (err as Error)?.name === 'WsAuthError';
      const motivo = esWsAuthError ? (err as Error).message : 'No autorizado';
      this.logger.warn(`Conexión a /menu rechazada: ${motivo}`);
      throw new Error(motivo);
    }

    if (!ROLES_CANAL_MENU.some((rol) => user.roles.includes(rol))) {
      this.logger.warn(
        `Conexión a /menu rechazada: rol no autorizado (${user.roles.join(',')})`,
      );
      throw new Error('Rol no autorizado para este canal.');
    }

    socket.data.user = user;
  }

  /**
   * BL-515: la sala sale del tenant del token, nunca del query string (el
   * tenantId del QR es público).
   */
  async handleConnection(client: SocketMenu) {
    const user = client.data.user;
    if (!user) {
      client.disconnect(true);
      return;
    }
    await client.join(`tenant_${user.tenantId}`);
    this.logger.log(`Cliente ${client.id} unido a tenant_${user.tenantId}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente desconectado: ${client.id}`);
  }

  // Emite evento cuando un ítem cambia su disponibilidad
  emitItemUpdated(
    tenantId: string,
    payload: { itemId: string; disponible: boolean },
  ) {
    this.server.to(`tenant_${tenantId}`).emit('menu:item:updated', payload);
  }

  // Emite evento cuando una categoría cambia su estado activo
  emitCategoriaUpdated(
    tenantId: string,
    payload: { categoriaId: string; activo: boolean },
  ) {
    this.server
      .to(`tenant_${tenantId}`)
      .emit('menu:categoria:updated', payload);
  }

  // Emite evento cuando un ítem se actualiza (nombre, precio, etc.).
  // BL-515: solo con los campos de la pantalla (datosItemParaPantalla).
  emitItemDataUpdated(
    tenantId: string,
    payload: { itemId: string; data: Record<string, unknown> },
  ) {
    this.server.to(`tenant_${tenantId}`).emit('menu:item:data:updated', {
      itemId: payload.itemId,
      data: datosItemParaPantalla(payload.data),
    });
  }

  // BL-394: un ítem se archivó o se eliminó; las pantallas lo sacan.
  emitItemRetirado(tenantId: string, payload: { itemId: string }) {
    this.server.to(`tenant_${tenantId}`).emit('menu:item:retirado', payload);
  }

  // BL-399: cambió el orden de la carta; las pantallas la vuelven a cargar.
  emitCartaReordenada(tenantId: string) {
    this.server.to(`tenant_${tenantId}`).emit('menu:carta:reordenada', {});
  }

  // BL-394: una categoría se archivó o se eliminó; las pantallas la sacan.
  emitCategoriaRetirada(tenantId: string, payload: { categoriaId: string }) {
    this.server
      .to(`tenant_${tenantId}`)
      .emit('menu:categoria:retirada', payload);
  }
}
