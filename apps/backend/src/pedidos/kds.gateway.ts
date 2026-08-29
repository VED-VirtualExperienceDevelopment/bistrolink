import { Injectable, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

// Alcance de HU-003: emitir el evento cuando se confirma un pedido. La
// pantalla real del KDS (quién la consume, cómo se autentica cocina en el
// handshake, reconexión) es HU-004 (Sprint 3) — ver Anexo 5. No construir
// de más acá lo que le corresponde a esa historia.
//
// Lo que SÍ es de HU-003 (criterio de seguridad propio): "el payload del
// WebSocket no incluye datos de otros tenants" — por eso cada conexión se
// une a una sala scopeada por tenant, y solo se emite a esa sala, nunca en
// broadcast global.
@Injectable()
@WebSocketGateway({
  // Mismo criterio (abierto) que app.enableCors() en main.ts — ya reportado
  // como hallazgo de seguridad aparte, no se restringe acá de forma
  // inconsistente con el resto de la app.
  cors: { origin: '*' },
})
export class KdsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(KdsGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    this.logger.log(`Cliente WS conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente WS desconectado: ${client.id}`);
  }

  // Placeholder minimalista para HU-003: une al cliente a la sala de su
  // tenant. HU-004 va a reemplazar esto por autenticación JWT real en el
  // handshake (ver su propio criterio de aceptación) — acá alcanza con que
  // el aislamiento por sala exista, no con resolver quién tiene permiso de
  // unirse.
  @SubscribeMessage('join-tenant')
  handleJoinTenant(client: Socket, tenantId: string) {
    client.join(this.salaTenant(tenantId));
  }

  emitirNuevoPedido(tenantId: string, pedido: unknown) {
    this.server.to(this.salaTenant(tenantId)).emit('pedido:nuevo', pedido);
  }

  private salaTenant(tenantId: string): string {
    return `tenant:${tenantId}`;
  }
}
