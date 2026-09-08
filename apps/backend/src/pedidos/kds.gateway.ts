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

@Injectable()
@WebSocketGateway({
  cors: { origin: '*' },
})
export class KdsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private static readonly ROLES_CONEXION_KDS = ['ADMIN', 'MOZO', 'COCINA'];

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly wsAuth: WsAuthService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private obtenerToken(client: Socket): string | undefined {
    return (
      (client.handshake.auth?.token as string | undefined) ??
      client.handshake.headers.authorization?.replace('Bearer ', '')
    );
  }

  private async resolverPedidosTransicion(): Promise<PedidosTransicionService> {
    const contextId = ContextIdFactory.create();
    return this.moduleRef.resolve(PedidosTransicionService, contextId, {
      strict: false,
    });
  }

  async handleConnection(client: Socket) {
    const token = this.obtenerToken(client);

    try {
      const user = await this.wsAuth.verify(token);

      const esStaffKds = KdsGateway.ROLES_CONEXION_KDS.some((r) =>
        user.roles.includes(r),
      );
      const esComensal = user.roles.includes('COMENSAL');

      if (!esStaffKds && !esComensal) {
        Logger.warn(
          `Conexion WS rechazada: rol no autorizado (${user.roles.join(',')})`,
          KdsGateway.name,
        );
        client.emit('error', {
          message: 'Rol no autorizado para este canal.',
        });
        client.disconnect(true);
        return;
      }

      if (esComensal) {
        Logger.log(
          `WS conectado (comensal): tenant=${user.tenantId}`,
          KdsGateway.name,
        );
        return;
      }

      await client.join(this.salaTenant(user.tenantId));

      Logger.log(
        `WS conectado (staff): tenant=${user.tenantId} roles=${user.roles.join(',')}`,
        KdsGateway.name,
      );

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

  @SubscribeMessage('pedido:transicion')
  async onTransicion(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { pedidoId: string; nuevoEstado: PedidoEstado },
  ) {
    let user;
    try {
      user = await this.wsAuth.verify(this.obtenerToken(client));
    } catch {
      client.emit('error', {
        message: 'Sesion invalida o expirada - reconecta.',
      });
      client.disconnect(true);
      return;
    }

    if (!user.roles.includes('MOZO') && !user.roles.includes('ADMIN')) {
      client.emit('error', {
        message:
          'El rol Cocina es de solo lectura (RD.06). La transicion debe operarla Mozo o Administrador.',
      });
      return;
    }

    try {
      const pedidosTransicion = await this.resolverPedidosTransicion();
      const actualizado = await pedidosTransicion.transicionar({
        tenantId: user.tenantId,
        keycloakId: user.sub,
        pedidoId: body.pedidoId,
        nuevoEstado: body.nuevoEstado,
      });

      this.server
        .to(this.salaTenant(user.tenantId))
        .emit('pedido:actualizado', actualizado);
      this.server
        .to(this.salaPedido(body.pedidoId))
        .emit('pedido:actualizado', actualizado);
    } catch (err) {
      client.emit('error', { message: (err as Error).message });
    }
  }

  @SubscribeMessage('pedidos:sync')
  async onSync(@ConnectedSocket() client: Socket) {
    let user;
    try {
      user = await this.wsAuth.verify(this.obtenerToken(client));
    } catch {
      client.emit('error', {
        message: 'Sesion invalida o expirada - reconecta.',
      });
      client.disconnect(true);
      return;
    }

    // HU-006: mismo chequeo de rol que handleConnection. Sin esto, un
    // COMENSAL con un token valido (el de su propio pedido) podria emitir
    // este evento a mano y recibir el snapshot COMPLETO del tenant - todos
    // los pedidos de todas las mesas, no solo el suyo.
    if (!KdsGateway.ROLES_CONEXION_KDS.some((r) => user.roles.includes(r))) {
      client.emit('error', {
        message: 'Rol no autorizado para acceder al snapshot del KDS.',
      });
      return;
    }

    const pedidosTransicion = await this.resolverPedidosTransicion();
    const pendientes = await pedidosTransicion.listarPendientes(user.tenantId);
    client.emit('pedidos:snapshot', pendientes);
  }

  @SubscribeMessage('pedido:seguir')
  async onSeguirPedido(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { pedidoId: string },
  ) {
    let user;
    try {
      user = await this.wsAuth.verify(this.obtenerToken(client));
    } catch {
      client.emit('error', {
        message: 'Sesion invalida o expirada - reconecta.',
      });
      client.disconnect(true);
      return;
    }

    const pedidosTransicion = await this.resolverPedidosTransicion();

    let resumen;
    try {
      resumen = await pedidosTransicion.obtenerResumen(
        user.tenantId,
        body.pedidoId,
      );
    } catch {
      // Cubre tanto "no existe" como "formato invalido" (ej. no es un UUID)
      // con el mismo mensaje generico - no hay que distinguirle al cliente
      // CUAL de los dos motivos fue, es informacion que no le corresponde.
      client.emit('error', { message: 'Pedido no encontrado' });
      return;
    }

    if (!resumen) {
      client.emit('error', { message: 'Pedido no encontrado' });
      return;
    }

    await client.join(this.salaPedido(body.pedidoId));
    client.emit('pedido:actualizado', resumen);
  }

  emitirNuevoPedido(tenantId: string, pedido: unknown) {
    this.server.to(this.salaTenant(tenantId)).emit('pedido:nuevo', pedido);
  }

  private salaTenant(tenantId: string): string {
    return `tenant:${tenantId}`;
  }

  private salaPedido(pedidoId: string): string {
    return `pedido:${pedidoId}`;
  }
}
