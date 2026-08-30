import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef, ContextIdFactory } from '@nestjs/core';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PedidoEstado } from '@prisma/client';
import { WsAuthService, WsAuthError } from './ws-auth.service';
import { PedidosTransicionService } from './pedidos-transicion.service';

// Evolucion del placeholder de HU-003: 'join-tenant' desaparece, el join a
// la sala pasa a ser automatico y solo tras validar el JWT en handleConnection.
//
// PedidosTransicionService depende de TenantPrismaService (scope REQUEST),
// asi que se resuelve manualmente via ModuleRef + ContextId sintetico en
// vez de inyectarse por constructor - inyectarlo directo contagia todo el
// Gateway al scope REQUEST, algo que los WebSocket Gateways no soportan
// (no hay un "request HTTP" detras de cada conexion). WsAuthService no
// tiene esa dependencia, asi que se inyecta normal.
@Injectable()
@WebSocketGateway({
  cors: { origin: '*' },
})
export class KdsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly wsAuth: WsAuthService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private async resolverPedidosTransicion(): Promise<PedidosTransicionService> {
    const contextId = ContextIdFactory.create();
    return this.moduleRef.resolve(PedidosTransicionService, contextId, {
      strict: false,
    });
  }

  /** Punto 3: autenticacion del WebSocket (JWT de Keycloak en el handshake) */
  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      client.handshake.headers.authorization?.replace('Bearer ', '');

    try {
      const user = await this.wsAuth.verify(token);

      client.data.tenantId = user.tenantId;
      client.data.roles = user.roles;
      client.data.keycloakId = user.sub;

      // Punto 1 + 4: sala por tenant, aislamiento multi-tenant (RD.07). El
      // nombre de la sala nunca lo elige el cliente - se deriva solo del
      // tenantId ya validado en el token.
      await client.join(this.salaTenant(user.tenantId));

      Logger.log(
        `WS conectado: tenant=${user.tenantId} roles=${user.roles.join(',')}`,
        KdsGateway.name,
      );

      // Snapshot inicial - tambien sirve para el caso de reconexion tras
      // un corte, junto con 'pedidos:sync' mas abajo.
      const pedidosTransicion = await this.resolverPedidosTransicion();
      const pendientes = await pedidosTransicion.listarPendientes(
        user.tenantId,
      );
      client.emit('pedidos:snapshot', pendientes);
    } catch (err) {
      const esWsAuthError =
        err instanceof WsAuthError || (err as Error)?.name === 'WsAuthError';
      const motivo = esWsAuthError ? (err as Error).message : 'No autorizado';
      Logger.warn(`Conexion WS rechazada: ${motivo}`, KdsGateway.name);
      client.emit('error', { message: motivo });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    Logger.log(`Cliente WS desconectado: ${client.id}`, KdsGateway.name);
  }

  /**
   * Punto 2: transicion de estado pedida desde el KDS.
   * Punto 4 (autorizacion): RD.06 - Cocina es de solo lectura. El rol no
   * existe siquiera en UsuarioRol (solo ADMIN|MOZO), asi que la regla aca
   * es la unica linea de defensa real para este evento.
   */
  @SubscribeMessage('pedido:transicion')
  async onTransicion(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { pedidoId: string; nuevoEstado: PedidoEstado },
  ) {
    const { tenantId, roles, keycloakId } = client.data as {
      tenantId: string;
      roles: string[];
      keycloakId: string;
    };

    if (!roles.includes('MOZO') && !roles.includes('ADMIN')) {
      client.emit('error', {
        message:
          'El rol Cocina es de solo lectura (RD.06). La transicion debe operarla Mozo o Administrador.',
      });
      return;
    }

    try {
      const pedidosTransicion = await this.resolverPedidosTransicion();
      const actualizado = await pedidosTransicion.transicionar({
        tenantId,
        keycloakId,
        pedidoId: body.pedidoId,
        nuevoEstado: body.nuevoEstado,
      });

      // Misma sala para KDS y vista del comensal (ver comentario de arriba).
      this.server
        .to(this.salaTenant(tenantId))
        .emit('pedido:actualizado', actualizado);
    } catch (err) {
      client.emit('error', { message: (err as Error).message });
    }
  }

  /** Resincronizacion explicita post-reconexion (DoD: "sin perdida") */
  @SubscribeMessage('pedidos:sync')
  async onSync(@ConnectedSocket() client: Socket) {
    const { tenantId } = client.data as { tenantId: string };
    const pedidosTransicion = await this.resolverPedidosTransicion();
    const pendientes = await pedidosTransicion.listarPendientes(tenantId);
    client.emit('pedidos:snapshot', pendientes);
  }

  /** Ya existente - HU-003 lo llama al confirmar un pedido nuevo. */
  emitirNuevoPedido(tenantId: string, pedido: unknown) {
    this.server.to(this.salaTenant(tenantId)).emit('pedido:nuevo', pedido);
  }

  private salaTenant(tenantId: string): string {
    return `tenant:${tenantId}`;
  }
}
