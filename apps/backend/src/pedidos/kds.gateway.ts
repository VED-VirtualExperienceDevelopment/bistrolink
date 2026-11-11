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
import { MesaEstado, PedidoEstado } from '@prisma/client';
import { WsAuthService, WsAuthError } from './ws-auth.service';
import { PedidosTransicionService } from './pedidos-transicion.service';
import { origenesPermitidos } from '../seguridad-http';
import { AlertasPendientes } from './alertas-pendientes';
import type { EstadoCola } from './cola-kds';
import type { UmbralesEspera } from './umbrales-espera';
import { QrMesaAccesoService } from '../qr-mesa/qr-mesa-acceso.service';

/** Qué hizo el mozo con la alerta: la atendió o la descartó. */
export type AccionLlamado = 'aceptado' | 'desestimado';
const ACCIONES_LLAMADO: ReadonlySet<string> = new Set([
  'aceptado',
  'desestimado',
]);

/** HU-031b (BL-442): datos del llamado de una mesa que quiere pagar en efectivo. */
/** BL-518: aviso al comensal de que la sesión de su mesa terminó. */
export interface SesionMesaCerrada {
  sesionMesa: string;
}

/** BL-518: respuesta (ack) de `mesa:seguir`. */
export interface SeguimientoMesa {
  siguiendo: boolean;
}
const NO_SIGUE: SeguimientoMesa = { siguiendo: false };

export interface LlamadoPagoEfectivo {
  pedidoId: string;
  /** Total del pedido, con 2 decimales. */
  total: string;
  /** Con cuánto va a pagar el comensal, si lo dijo. */
  pagaCon: string | null;
}

@Injectable()
// BL-426: antes `origin: '*'`. Los dos gateways comparten el servidor de
// socket.io, así que tienen que declarar la misma lista que la API.
@WebSocketGateway({
  cors: { origin: origenesPermitidos() },
})
export class KdsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private static readonly ROLES_CONEXION_KDS = ['ADMIN', 'MOZO', 'COCINA'];
  // BL-460: los avisos del salón (llamados y pago en efectivo) son del Mozo y
  // del Administrador. Cocina solo necesita las comandas.
  private static readonly ROLES_SALON = ['ADMIN', 'MOZO'];

  @WebSocketServer()
  server: Server;

  // BL-441: alertas pendientes por establecimiento, para que sobrevivan a un
  // refresco, una reconexión o una pestaña cerrada. Ver alertas-pendientes.ts.
  private readonly alertas = new AlertasPendientes();

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

  private resolverQrMesaAcceso(): Promise<QrMesaAccesoService> {
    const contextId = ContextIdFactory.create();
    return this.moduleRef.resolve(QrMesaAccesoService, contextId, {
      strict: false,
    });
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
      // BL-460: Cocina queda afuera de la sala del salón, así que no recibe
      // los llamados ni el total y el «paga con» del pago en efectivo.
      if (this.esSalon(user.roles)) {
        await client.join(this.salaSalon(user.tenantId));
      }
      // HU-015 (BL-120): las alertas de stock son solo del administrador.
      if (user.roles.includes('ADMIN')) {
        await client.join(this.salaAdmin(user.tenantId));
      }

      Logger.log(
        `WS conectado (staff): tenant=${user.tenantId} roles=${user.roles.join(',')}`,
        KdsGateway.name,
      );

      await this.enviarSnapshot(client, user.tenantId, user.roles);
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
      const { actualizado, promovidos } = await pedidosTransicion.transicionar({
        tenantId: user.tenantId,
        keycloakId: user.sub,
        pedidoId: body.pedidoId,
        nuevoEstado: body.nuevoEstado,
      });

      this.emitirPedidoActualizado(user.tenantId, actualizado);
      // HU-042 (BL-463): los que la cola pasó a preparación al liberarse
      // el lugar.
      for (const promovido of promovidos) {
        this.emitirPedidoActualizado(user.tenantId, promovido);
      }
    } catch (err) {
      client.emit('error', { message: (err as Error).message });
      return;
    }

    // HU-042 (BL-464): la cola pudo cambiar (entró o salió un pedido de
    // preparación). Después de avisar el cambio de estado.
    await this.avisarEstadoCola(user.tenantId);
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

    await this.enviarSnapshot(client, user.tenantId, user.roles);
  }

  /**
   * Estado actual para un KDS que se conecta o pide sincronizar: los pedidos
   * activos y las alertas pendientes (BL-441): los llamados guardados en el
   * servidor más los avisos de efectivo (BL-448) que el mozo todavía no atendió.
   * BL-460: esas alertas solo se mandan al salón (Mozo y Administrador).
   */
  private async enviarSnapshot(
    client: Socket,
    tenantId: string,
    roles: string[],
  ) {
    const pedidosTransicion = await this.resolverPedidosTransicion();
    const pendientes = await pedidosTransicion.listarPendientes(tenantId);
    client.emit('pedidos:snapshot', pendientes);
    // HU-038 (BL-506): umbrales de espera del local, también para Cocina.
    await this.enviarUmbralesEspera(client, tenantId, pedidosTransicion);
    // HU-042 (BL-464): estado de la cola, también para Cocina (secciones del
    // tablero). Sin cola activa no se manda: el KDS sigue como antes.
    await this.enviarEstadoCola(client, tenantId, pedidosTransicion);
    if (!this.esSalon(roles)) return;
    const solicitudes =
      await pedidosTransicion.listarSolicitudesEfectivo(tenantId);
    client.emit(
      'llamados:snapshot',
      this.alertas.snapshot(tenantId, solicitudes),
    );
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

    // HU-042 (BL-464): si el pedido está en espera, su lugar en la cola y
    // el tiempo estimado. Solo el suyo, nunca el de otros pedidos.
    if (resumen.estado === PedidoEstado.RECIBIDO) {
      try {
        const estado = await pedidosTransicion.estadoCola(user.tenantId);
        const suyo = estado.orden.find((p) => p.pedidoId === body.pedidoId);
        if (suyo) client.emit('pedido:cola', suyo);
      } catch (err) {
        Logger.warn(
          `No se pudo calcular el lugar en la cola: ${(err as Error).message}`,
          KdsGateway.name,
        );
      }
    }
  }

  /**
   * BL-518: el comensal sigue la sesión de su mesa para enterarse, sin
   * recargar, de que el mozo la cerró (`mesa:sesion_cerrada`).
   *
   * Se valida como cualquier acción de la mesa: el QR tiene que resolver a
   * una mesa del mismo local que el token y la sesión tiene que ser la
   * abierta. Si la mesa ya está cerrada, la sesión es vieja o el QR ya no
   * sirve, se le avisa enseguida (para el comensal es lo mismo: no puede
   * seguir pidiendo). La sala es por sesión: el grupo siguiente de la mesa
   * no recibe el aviso del anterior.
   */
  @SubscribeMessage('mesa:seguir')
  async onSeguirMesa(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { qrToken?: unknown; sesionMesa?: unknown },
  ): Promise<SeguimientoMesa> {
    let user;
    try {
      user = await this.wsAuth.verify(this.obtenerToken(client));
    } catch {
      client.emit('error', {
        message: 'Sesion invalida o expirada - reconecta.',
      });
      client.disconnect(true);
      return NO_SIGUE;
    }
    if (!user.roles.includes('COMENSAL')) {
      client.emit('error', { message: 'Solo para comensales.' });
      return NO_SIGUE;
    }

    const qrToken = body?.qrToken;
    const sesionMesa = body?.sesionMesa;
    if (typeof qrToken !== 'string' || typeof sesionMesa !== 'string') {
      client.emit('error', { message: 'Faltan el QR o la sesión de la mesa.' });
      return NO_SIGUE;
    }
    const cerrada: SesionMesaCerrada = { sesionMesa };

    let mesa;
    try {
      const acceso = await this.resolverQrMesaAcceso();
      mesa = await acceso.resolver(qrToken);
    } catch {
      // QR inválido o reemplazado: ya no puede pedir con él.
      client.emit('mesa:sesion_cerrada', cerrada);
      return NO_SIGUE;
    }

    if (mesa.tenantId !== user.tenantId) {
      client.emit('error', { message: 'Mesa no encontrada' });
      return NO_SIGUE;
    }
    if (!mesa.sesionId || mesa.sesionId !== sesionMesa) {
      client.emit('mesa:sesion_cerrada', cerrada);
      return NO_SIGUE;
    }

    await client.join(this.salaSesionMesa(mesa.sesionId));
    return { siguiendo: true };
  }

  @SubscribeMessage('llamado:resolver')
  async onResolverLlamado(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { mesaId: string; accion: AccionLlamado },
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
        message: 'Solo Mozo o Administrador pueden resolver un llamado.',
      });
      return;
    }

    if (
      typeof body?.mesaId !== 'string' ||
      body.mesaId.length === 0 ||
      !ACCIONES_LLAMADO.has(body.accion)
    ) {
      client.emit('error', { message: 'Solicitud de alerta inválida.' });
      return;
    }

    // Se loguea la acción y la mesa, nunca quién la hizo (privacidad).
    Logger.log(
      `Llamado ${body.accion}: mesa=${body.mesaId} tenant=${user.tenantId}`,
      KdsGateway.name,
    );

    const quitada = this.alertas.resolver(user.tenantId, body.mesaId);
    if (!quitada?.pedidoId) {
      // Si la mesa tiene un aviso de efectivo que viene de la base, hay que
      // anotarlo como atendido o volvería a aparecer al refrescar.
      await this.marcarEfectivoAtendido(user.tenantId, body.mesaId);
    }

    this.server
      .to(this.salaSalon(user.tenantId))
      .emit('llamado:resuelto', { mesaId: body.mesaId, accion: body.accion });
  }

  private async marcarEfectivoAtendido(tenantId: string, mesaId: string) {
    try {
      const pedidosTransicion = await this.resolverPedidosTransicion();
      const solicitudes =
        await pedidosTransicion.listarSolicitudesEfectivo(tenantId);
      const delaMesa = solicitudes.find((s) => s.mesaId === mesaId);
      if (delaMesa) this.alertas.resolver(tenantId, mesaId, delaMesa.pedidoId);
    } catch (err) {
      Logger.warn(
        `No se pudo revisar el efectivo pendiente de la mesa ${mesaId}: ${(err as Error).message}`,
        KdsGateway.name,
      );
    }
  }

  /**
   * La mesa se cerró (BL-448): cancela los pedidos sin pagar, así que no
   * queda alerta que atender. Se saca del almacén y de todo el salón del
   * tenant. Aceptar o desestimar pasa por `llamado:resolver`.
   */
  emitirLlamadoResuelto(tenantId: string, mesaId: string) {
    this.alertas.cerrarMesa(tenantId, mesaId);
    this.server
      .to(this.salaSalon(tenantId))
      .emit('llamado:resuelto', { mesaId });
  }

  emitirNuevoPedido(tenantId: string, pedido: unknown) {
    // El pedido llega confirmado y cobrado: su aviso de efectivo ya no aplica.
    const pedidoId = (pedido as { id?: unknown } | null)?.id;
    if (typeof pedidoId === 'string') {
      this.alertas.pedidoCobrado(tenantId, pedidoId);
    }
    this.server.to(this.salaTenant(tenantId)).emit('pedido:nuevo', pedido);
  }

  /**
   * HU-012 (BL-219): el resumen de ventas cambió (se aprobó un pago). El
   * dashboard de reportes vuelve a pedir los datos; el evento no lleva datos
   * de ventas, solo la hora.
   */
  emitirReportesActualizados(tenantId: string) {
    this.server
      .to(this.salaTenant(tenantId))
      .emit('reportes:actualizado', { ts: new Date().toISOString() });
  }

  /**
   * HU-042 (BL-464): la cola cambió. Al staff del tenant, `cola:actualizada`
   * con el estado completo; a cada comensal en espera, `pedido:cola` con su
   * lugar y su tiempo (sala del pedido: solo lo recibe quien lo sigue).
   */
  emitirEstadoCola(tenantId: string, estado: EstadoCola) {
    this.server.to(this.salaTenant(tenantId)).emit('cola:actualizada', estado);
    for (const lugar of estado.orden) {
      this.server
        .to(this.salaPedido(lugar.pedidoId))
        .emit('pedido:cola', lugar);
    }
  }

  /**
   * HU-042 (BL-464): lee el estado de la cola y lo avisa. Nunca lanza: el
   * cambio que lo disparó ya se guardó y se avisó; si falla, el KDS se
   * corrige con el próximo cambio o al reconectar.
   *
   * HU-042 (BL-465): con `forzar`, avisa también con la cola desactivada,
   * para que el KDS abierto deje de mostrar la cola (el administrador la
   * apagó desde Configuración).
   */
  async avisarEstadoCola(tenantId: string, opciones?: { forzar?: boolean }) {
    try {
      const pedidosTransicion = await this.resolverPedidosTransicion();
      const estado = await pedidosTransicion.estadoCola(tenantId);
      if (estado.activa || opciones?.forzar) {
        this.emitirEstadoCola(tenantId, estado);
      }
    } catch (err) {
      Logger.warn(
        `No se pudo avisar el estado de la cola: ${(err as Error).message}`,
        KdsGateway.name,
      );
    }
  }

  /**
   * HU-038 (BL-506): el administrador cambió los umbrales de espera. A todo
   * el staff del tenant (también Cocina), para que el KDS abierto repinte las
   * comandas sin recargar.
   */
  emitirUmbralesEspera(tenantId: string, umbrales: UmbralesEspera) {
    this.server
      .to(this.salaTenant(tenantId))
      .emit('kds:umbrales-espera', umbrales);
  }

  private async enviarUmbralesEspera(
    client: Socket,
    tenantId: string,
    pedidosTransicion: PedidosTransicionService,
  ) {
    try {
      const umbrales = await pedidosTransicion.umbralesEspera(tenantId);
      client.emit('kds:umbrales-espera', umbrales);
    } catch (err) {
      // El snapshot de pedidos ya salió: el KDS sigue con los umbrales de
      // por defecto (o los últimos que recibió) y no se corta la conexión.
      Logger.warn(
        `No se pudieron enviar los umbrales de espera: ${(err as Error).message}`,
        KdsGateway.name,
      );
    }
  }

  private async enviarEstadoCola(
    client: Socket,
    tenantId: string,
    pedidosTransicion: PedidosTransicionService,
  ) {
    try {
      const estado = await pedidosTransicion.estadoCola(tenantId);
      if (estado.activa) client.emit('cola:actualizada', estado);
    } catch (err) {
      // El snapshot de pedidos ya salió: no se corta la conexión por esto.
      Logger.warn(
        `No se pudo enviar el estado de la cola: ${(err as Error).message}`,
        KdsGateway.name,
      );
    }
  }

  /**
   * Un pedido cambió de estado: al staff del tenant (KDS y mozo) y al
   * comensal que lo sigue (sala del pedido). HU-042 (BL-463): también lo
   * usa la cola al pasar un pedido a preparación.
   */
  emitirPedidoActualizado(tenantId: string, actualizado: { id: string }) {
    this.server
      .to(this.salaTenant(tenantId))
      .emit('pedido:actualizado', actualizado);
    this.server
      .to(this.salaPedido(actualizado.id))
      .emit('pedido:actualizado', actualizado);
  }

  // BL-311: avisa al comensal que sigue el pedido (sala del pedido, la que
  // se une con pedido:seguir) que el pedido cambió de estado.
  emitirActualizacionPedido(pedidoId: string, actualizado: unknown) {
    this.server
      .to(this.salaPedido(pedidoId))
      .emit('pedido:actualizado', actualizado);
  }

  /**
   * HU-019/BL-68: el comensal llama al mozo. HU-031b (BL-442): con `pago`,
   * el llamado es porque quiere pagar en efectivo (el banner muestra el
   * total y con cuánto paga). Sin `pago`, el payload no cambia.
   */
  emitirLlamado(
    tenantId: string,
    mesaId: string,
    mesaNumero: number,
    pago?: LlamadoPagoEfectivo,
  ) {
    const llamado = {
      mesaId,
      mesaNumero,
      ts: Date.now(),
      ...(pago && { motivo: 'PAGO_EFECTIVO' as const, ...pago }),
    };
    // BL-441: se guarda antes de emitir, así un KDS que se conecta justo
    // después lo recibe en el snapshot.
    this.alertas.agregar(tenantId, llamado);
    // BL-460: solo el salón; Cocina no recibe el total ni el «paga con».
    this.server.to(this.salaSalon(tenantId)).emit('llamado:nuevo', llamado);
  }

  // HU-016/HU-017: punto de entrada único para propagar un cambio de estado
  // de mesa a todo el staff conectado del tenant, para que el mapa visual
  // (HU-016) se actualice en vivo sin poll. Lo llama MesasService al abrir,
  // cerrar y marcar limpia la sesión de la mesa (HU-017, BL-60).
  emitirEstadoMesa(tenantId: string, mesaId: string, estado: MesaEstado) {
    this.server
      .to(this.salaTenant(tenantId))
      .emit('mesa:estado_actualizado', { mesaId, estado, ts: Date.now() });
  }

  /**
   * HU-015 (BL-120): alerta de stock bajo o agotado, solo a los
   * administradores del tenant. Solo nombre y cantidades (BL-122).
   */
  emitirAlertaStock(tenantId: string, alerta: unknown) {
    this.server.to(this.salaAdmin(tenantId)).emit('stock:alerta', alerta);
  }

  /**
   * HU-015 (BL-120): el administrador ajustó el stock (jornada o
   * reposición). Las campanas abiertas vuelven a pedir las alertas.
   */
  emitirStockActualizado(tenantId: string) {
    this.server
      .to(this.salaAdmin(tenantId))
      .emit('stock:actualizado', { ts: new Date().toISOString() });
  }

  private salaAdmin(tenantId: string): string {
    return `admin:${tenantId}`;
  }

  private salaSalon(tenantId: string): string {
    return `salon:${tenantId}`;
  }

  private esSalon(roles: string[]): boolean {
    return KdsGateway.ROLES_SALON.some((r) => roles.includes(r));
  }

  private salaTenant(tenantId: string): string {
    return `tenant:${tenantId}`;
  }

  /**
   * BL-518: el mozo cerró la mesa. Avisa a los comensales que seguían esa
   * sesión (`mesa:seguir`) para que su pantalla lo muestre sin recargar.
   */
  emitirSesionCerrada(sesionId: string) {
    const aviso: SesionMesaCerrada = { sesionMesa: sesionId };
    this.server
      .to(this.salaSesionMesa(sesionId))
      .emit('mesa:sesion_cerrada', aviso);
  }

  private salaSesionMesa(sesionId: string): string {
    return `sesion-mesa:${sesionId}`;
  }

  private salaPedido(pedidoId: string): string {
    return `pedido:${pedidoId}`;
  }
}
