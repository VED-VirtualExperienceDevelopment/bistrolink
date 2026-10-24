import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { origenesPermitidos } from '../seguridad-http';

// Gateway WebSocket para emitir cambios en tiempo real del menú
// a todos los clientes conectados del mismo tenant.
@WebSocketGateway({
  // BL-426: la misma lista de orígenes que la API (seguridad-http.ts).
  cors: {
    origin: origenesPermitidos(),
    credentials: true,
  },
  namespace: '/menu',
})
export class MenuGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MenuGateway.name);

  handleConnection(client: Socket) {
    const tenantId = client.handshake.query.tenantId as string;
    if (tenantId) {
      // Cada cliente se une a una "room" específica de su tenant
      client.join(`tenant_${tenantId}`);
      this.logger.log(`Cliente ${client.id} unido a tenant_${tenantId}`);
    }
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

  // Emite evento cuando un ítem se actualiza (nombre, precio, etc.)
  emitItemDataUpdated(
    tenantId: string,
    payload: { itemId: string; data: Record<string, unknown> },
  ) {
    this.server
      .to(`tenant_${tenantId}`)
      .emit('menu:item:data:updated', payload);
  }
}
