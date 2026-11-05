import { MesaEstado, PedidoEstado } from '@prisma/client';
import { KdsGateway } from '../../src/pedidos/kds.gateway';
import { WsAuthError } from '../../src/pedidos/ws-auth.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID_AJENO = 'aaaaaaaa-0000-0000-0000-000000000001';

function mockClient(overrides: Record<string, unknown> = {}) {
  return {
    id: 'socket-123',
    handshake: { auth: { token: 'token-valido' }, headers: {} },
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    ...overrides,
  };
}

describe('KdsGateway', () => {
  let gateway: KdsGateway;
  let mockServer: { to: jest.Mock; emit: jest.Mock };
  let mockWsAuth: { verify: jest.Mock };
  let mockPedidosTransicion: {
    listarPendientes: jest.Mock;
    listarSolicitudesEfectivo: jest.Mock;
    transicionar: jest.Mock;
    obtenerResumen: jest.Mock;
  };
  let mockModuleRef: { resolve: jest.Mock };

  beforeEach(() => {
    mockPedidosTransicion = {
      listarPendientes: jest.fn().mockResolvedValue([]),
      listarSolicitudesEfectivo: jest.fn().mockResolvedValue([]),
      transicionar: jest.fn(),
      obtenerResumen: jest.fn(),
    };
    mockModuleRef = {
      resolve: jest.fn().mockResolvedValue(mockPedidosTransicion),
    };
    mockWsAuth = { verify: jest.fn() };

    gateway = new KdsGateway(mockWsAuth as any, mockModuleRef as any);

    mockServer = { to: jest.fn(), emit: jest.fn() };
    mockServer.to.mockReturnValue({ emit: mockServer.emit });
    gateway.server = mockServer as any;
  });

  describe('handleConnection', () => {
    it('con JWT valido: une al cliente a la sala de su tenant y le manda el snapshot inicial', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'usuario-1',
        tenantId: TENANT_ID,
        roles: ['MOZO'],
      });
      const client = mockClient();

      await gateway.handleConnection(client as any);

      expect(client.join).toHaveBeenCalledWith(`tenant:${TENANT_ID}`);
      expect(mockPedidosTransicion.listarPendientes).toHaveBeenCalledWith(
        TENANT_ID,
      );
      expect(client.emit).toHaveBeenCalledWith('pedidos:snapshot', []);
    });

    it('[TC-U-340] HU-015: el administrador también entra a la sala de administradores; el mozo no', async () => {
      mockWsAuth.verify.mockResolvedValueOnce({
        sub: 'usuario-admin',
        tenantId: TENANT_ID,
        roles: ['ADMIN'],
      });
      const admin = mockClient();
      await gateway.handleConnection(admin as any);

      mockWsAuth.verify.mockResolvedValueOnce({
        sub: 'usuario-mozo',
        tenantId: TENANT_ID,
        roles: ['MOZO'],
      });
      const mozo = mockClient();
      await gateway.handleConnection(mozo as any);

      expect(admin.join).toHaveBeenCalledWith(`admin:${TENANT_ID}`);
      expect(mozo.join).not.toHaveBeenCalledWith(`admin:${TENANT_ID}`);
    });

    it('[BL-460] Mozo y Administrador entran a la sala del salón; Cocina no, aunque sí a la del tenant', async () => {
      const conectarCon = async (roles: string[]) => {
        mockWsAuth.verify.mockResolvedValueOnce({
          sub: 'usuario-x',
          tenantId: TENANT_ID,
          roles,
        });
        const client = mockClient();
        await gateway.handleConnection(client as any);
        return client;
      };

      const mozo = await conectarCon(['MOZO']);
      const admin = await conectarCon(['ADMIN']);
      const cocina = await conectarCon(['COCINA']);

      expect(mozo.join).toHaveBeenCalledWith(`salon:${TENANT_ID}`);
      expect(admin.join).toHaveBeenCalledWith(`salon:${TENANT_ID}`);
      expect(cocina.join).toHaveBeenCalledWith(`tenant:${TENANT_ID}`);
      expect(cocina.join).not.toHaveBeenCalledWith(`salon:${TENANT_ID}`);
    });

    it('[BL-460] un usuario con Cocina y Mozo entra a la sala del salón, porque tiene permisos de Mozo', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'usuario-mixto',
        tenantId: TENANT_ID,
        roles: ['COCINA', 'MOZO'],
      });
      const client = mockClient();

      await gateway.handleConnection(client as any);

      expect(client.join).toHaveBeenCalledWith(`salon:${TENANT_ID}`);
    });

    it('[BL-460] las salas del salón de dos establecimientos distintos no se pisan', async () => {
      mockWsAuth.verify.mockResolvedValueOnce({
        sub: 'mozo-a',
        tenantId: TENANT_ID,
        roles: ['MOZO'],
      });
      const mozoA = mockClient();
      await gateway.handleConnection(mozoA as any);

      mockWsAuth.verify.mockResolvedValueOnce({
        sub: 'mozo-b',
        tenantId: TENANT_ID_AJENO,
        roles: ['MOZO'],
      });
      const mozoB = mockClient();
      await gateway.handleConnection(mozoB as any);

      expect(mozoA.join).toHaveBeenCalledWith(`salon:${TENANT_ID}`);
      expect(mozoA.join).not.toHaveBeenCalledWith(`salon:${TENANT_ID_AJENO}`);
      expect(mozoB.join).toHaveBeenCalledWith(`salon:${TENANT_ID_AJENO}`);
    });

    it('sin token o token invalido: rechaza y desconecta, sin unir a ninguna sala', async () => {
      mockWsAuth.verify.mockRejectedValue(
        new WsAuthError('Token no provisto en el handshake'),
      );
      const client = mockClient({ handshake: { auth: {}, headers: {} } });

      await gateway.handleConnection(client as any);

      expect(client.join).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Token no provisto en el handshake',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('ante un error inesperado (no WsAuthError) durante la verificacion, cae al mensaje generico "No autorizado"', async () => {
      mockWsAuth.verify.mockRejectedValue(new Error('fallo de red inesperado'));
      const client = mockClient();

      await gateway.handleConnection(client as any);

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'No autorizado',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('[HU-006] rol COMENSAL: se conecta, pero NO se une a la sala del tenant ni recibe el snapshot completo', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'comensal-1',
        tenantId: TENANT_ID,
        roles: ['COMENSAL'],
      });
      const client = mockClient();

      await gateway.handleConnection(client as any);

      expect(client.join).not.toHaveBeenCalled();
      expect(mockPedidosTransicion.listarPendientes).not.toHaveBeenCalled();
      expect(client.emit).not.toHaveBeenCalledWith(
        'pedidos:snapshot',
        expect.anything(),
      );
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('rol sin ningun permiso (ni staff KDS ni COMENSAL) es rechazado', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'usuario-1',
        tenantId: TENANT_ID,
        roles: ['ROL_INVENTADO'],
      });
      const client = mockClient();

      await gateway.handleConnection(client as any);

      expect(client.join).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Rol no autorizado para este canal.',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  it('handleDisconnect no explota (solo loguea)', () => {
    const client = mockClient();
    expect(() => gateway.handleDisconnect(client as any)).not.toThrow();
  });

  describe('onTransicion', () => {
    it('rol COCINA es rechazado antes de tocar la DB (RD.06 - solo lectura)', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'usuario-1',
        tenantId: TENANT_ID,
        roles: ['COCINA'],
      });
      const client = mockClient();

      await gateway.onTransicion(client as any, {
        pedidoId: 'pedido-1',
        nuevoEstado: PedidoEstado.EN_PREPARACION,
      });

      expect(mockPedidosTransicion.transicionar).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          message: expect.stringContaining('de solo lectura'),
        }),
      );
    });

    it('rol MOZO ejecuta la transicion y emite pedido:actualizado a toda la sala del tenant', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'usuario-1',
        tenantId: TENANT_ID,
        roles: ['MOZO'],
      });
      const actualizado = {
        id: 'pedido-1',
        estado: PedidoEstado.EN_PREPARACION,
        actualizadoEn: '2026-08-30T12:00:00.000Z',
      };
      mockPedidosTransicion.transicionar.mockResolvedValue(actualizado);
      const client = mockClient();

      await gateway.onTransicion(client as any, {
        pedidoId: 'pedido-1',
        nuevoEstado: PedidoEstado.EN_PREPARACION,
      });

      expect(mockPedidosTransicion.transicionar).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        keycloakId: 'usuario-1',
        pedidoId: 'pedido-1',
        nuevoEstado: PedidoEstado.EN_PREPARACION,
      });
      expect(mockServer.to).toHaveBeenCalledWith(`tenant:${TENANT_ID}`);
      expect(mockServer.to).toHaveBeenCalledWith(`pedido:pedido-1`);
      expect(mockServer.emit).toHaveBeenCalledWith(
        'pedido:actualizado',
        actualizado,
      );
    });

    it('JWT invalido al momento del evento: desconecta en vez de crashear (condicion de carrera resuelta re-verificando por evento)', async () => {
      mockWsAuth.verify.mockRejectedValue(
        new WsAuthError('Token invalido o expirado'),
      );
      const client = mockClient();

      await gateway.onTransicion(client as any, {
        pedidoId: 'pedido-1',
        nuevoEstado: PedidoEstado.EN_PREPARACION,
      });

      expect(mockPedidosTransicion.transicionar).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('si transicionar() falla (ej. transicion invalida o pedido inexistente), reenvia el mensaje de error al cliente sin romper el gateway', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'usuario-1',
        tenantId: TENANT_ID,
        roles: ['MOZO'],
      });
      mockPedidosTransicion.transicionar.mockRejectedValue(
        new Error('Transición inválida: LISTO_PARA_ENTREGAR → EN_PREPARACION'),
      );
      const client = mockClient();

      await gateway.onTransicion(client as any, {
        pedidoId: 'pedido-1',
        nuevoEstado: PedidoEstado.EN_PREPARACION,
      });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Transición inválida: LISTO_PARA_ENTREGAR → EN_PREPARACION',
      });
      expect(mockServer.to).not.toHaveBeenCalled();
    });
  });

  describe('onSync', () => {
    it('con JWT valido: re-envia el snapshot de pedidos pendientes (DoD: reconexion sin perdida)', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'usuario-1',
        tenantId: TENANT_ID,
        roles: ['MOZO'],
      });
      const pendientes = [{ id: 'pedido-1', estado: PedidoEstado.RECIBIDO }];
      mockPedidosTransicion.listarPendientes.mockResolvedValue(pendientes);
      const client = mockClient();

      await gateway.onSync(client as any);

      expect(mockPedidosTransicion.listarPendientes).toHaveBeenCalledWith(
        TENANT_ID,
      );
      expect(client.emit).toHaveBeenCalledWith('pedidos:snapshot', pendientes);
    });

    it('[HU-006 seguridad] rol COMENSAL con JWT valido: rechazado, NUNCA recibe el snapshot completo del tenant', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'comensal-1',
        tenantId: TENANT_ID,
        roles: ['COMENSAL'],
      });
      const client = mockClient();

      await gateway.onSync(client as any);

      expect(mockPedidosTransicion.listarPendientes).not.toHaveBeenCalled();
      expect(client.emit).not.toHaveBeenCalledWith(
        'pedidos:snapshot',
        expect.anything(),
      );
      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Rol no autorizado para acceder al snapshot del KDS.',
      });
    });

    it('con JWT invalido o vencido: desconecta en vez de reenviar el snapshot', async () => {
      mockWsAuth.verify.mockRejectedValue(
        new WsAuthError('Token invalido o expirado'),
      );
      const client = mockClient();

      await gateway.onSync(client as any);

      expect(mockPedidosTransicion.listarPendientes).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Sesion invalida o expirada - reconecta.',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('onSeguirPedido', () => {
    const PEDIDO_ID = 'pedido-1';

    it('[HU-006] con el pedido encontrado: une al cliente a SU sala puntual y le manda el estado actual', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'comensal-1',
        tenantId: TENANT_ID,
        roles: ['COMENSAL'],
      });
      const resumen = {
        id: PEDIDO_ID,
        estado: PedidoEstado.RECIBIDO,
        actualizadoEn: '2026-08-30T12:00:00.000Z',
      };
      mockPedidosTransicion.obtenerResumen.mockResolvedValue(resumen);
      const client = mockClient();

      await gateway.onSeguirPedido(client as any, { pedidoId: PEDIDO_ID });

      expect(mockPedidosTransicion.obtenerResumen).toHaveBeenCalledWith(
        TENANT_ID,
        PEDIDO_ID,
      );
      expect(client.join).toHaveBeenCalledWith(`pedido:${PEDIDO_ID}`);
      expect(client.emit).toHaveBeenCalledWith('pedido:actualizado', resumen);
    });

    it('[HU-006 seguridad] pedido inexistente o de OTRO tenant: no lo encuentra (RLS), no une a ninguna sala', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'comensal-1',
        tenantId: TENANT_ID,
        roles: ['COMENSAL'],
      });
      mockPedidosTransicion.obtenerResumen.mockResolvedValue(null);
      const client = mockClient();

      await gateway.onSeguirPedido(client as any, {
        pedidoId: 'pedido-de-otro-tenant',
      });

      expect(client.join).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Pedido no encontrado',
      });
    });

    it('[HU-006] pedidoId con formato invalido (no UUID): Prisma tira excepcion, se atrapa y se responde igual que "no encontrado"', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'comensal-1',
        tenantId: TENANT_ID,
        roles: ['COMENSAL'],
      });
      mockPedidosTransicion.obtenerResumen.mockRejectedValue(
        new Error('Invalid `prisma.pedido.findUnique()` invocation'),
      );
      const client = mockClient();

      await gateway.onSeguirPedido(client as any, {
        pedidoId: 'no-es-un-uuid',
      });

      expect(client.join).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Pedido no encontrado',
      });
    });

    it('JWT invalido o vencido: desconecta en vez de intentar unir a ninguna sala', async () => {
      mockWsAuth.verify.mockRejectedValue(
        new WsAuthError('Token invalido o expirado'),
      );
      const client = mockClient();

      await gateway.onSeguirPedido(client as any, { pedidoId: PEDIDO_ID });

      expect(mockPedidosTransicion.obtenerResumen).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('emitirNuevoPedido', () => {
    it('emite solo a la sala del tenant correspondiente', () => {
      const pedido = { id: 'pedido-1', tenantId: TENANT_ID };

      gateway.emitirNuevoPedido(TENANT_ID, pedido);

      expect(mockServer.to).toHaveBeenCalledWith(`tenant:${TENANT_ID}`);
      expect(mockServer.emit).toHaveBeenCalledWith('pedido:nuevo', pedido);
    });

    it('dos tenants distintos arman nombres de sala distintos - nunca se pisan', () => {
      gateway.emitirNuevoPedido(TENANT_ID, { id: 'pedido-a' });
      gateway.emitirNuevoPedido(TENANT_ID_AJENO, { id: 'pedido-b' });

      expect(mockServer.to).toHaveBeenNthCalledWith(1, `tenant:${TENANT_ID}`);
      expect(mockServer.to).toHaveBeenNthCalledWith(
        2,
        `tenant:${TENANT_ID_AJENO}`,
      );
    });
  });

  describe('emitirLlamado', () => {
    it('emite el llamado a la sala del salón con mesaId y mesaNumero', () => {
      gateway.emitirLlamado(TENANT_ID, 'mesa-1', 5);

      expect(mockServer.to).toHaveBeenCalledWith(`salon:${TENANT_ID}`);
      expect(mockServer.emit).toHaveBeenCalledWith(
        'llamado:nuevo',
        expect.objectContaining({ mesaId: 'mesa-1', mesaNumero: 5 }),
      );
      // Sin pago: el payload de siempre, sin motivo.
      expect(mockServer.emit.mock.calls[0][1]).not.toHaveProperty('motivo');
    });

    it('[BL-460] el llamado no se emite a la sala del tenant, donde está Cocina', () => {
      gateway.emitirLlamado(TENANT_ID, 'mesa-1', 5);
      gateway.emitirLlamado(TENANT_ID, 'mesa-2', 6, {
        pedidoId: 'pedido-1',
        total: '810.00',
        pagaCon: '1000.00',
      });

      expect(mockServer.to).not.toHaveBeenCalledWith(`tenant:${TENANT_ID}`);
      expect(mockServer.to).toHaveBeenCalledTimes(2);
      expect(mockServer.to).toHaveBeenNthCalledWith(1, `salon:${TENANT_ID}`);
      expect(mockServer.to).toHaveBeenNthCalledWith(2, `salon:${TENANT_ID}`);
    });

    it('HU-031b (BL-442): con pago en efectivo, suma el motivo, el pedido, el total y con cuánto paga', () => {
      gateway.emitirLlamado(TENANT_ID, 'mesa-1', 5, {
        pedidoId: 'pedido-1',
        total: '810.00',
        pagaCon: '1000.00',
      });

      expect(mockServer.emit).toHaveBeenCalledWith('llamado:nuevo', {
        mesaId: 'mesa-1',
        mesaNumero: 5,
        ts: expect.any(Number),
        motivo: 'PAGO_EFECTIVO',
        pedidoId: 'pedido-1',
        total: '810.00',
        pagaCon: '1000.00',
      });
    });
  });

  describe('BL-448: avisos de efectivo pendientes', () => {
    const SOLICITUD = {
      mesaId: 'mesa-3',
      mesaNumero: 3,
      ts: 1_761_955_200_000,
      motivo: 'PAGO_EFECTIVO',
      pedidoId: 'pedido-1',
      total: '250.00',
      pagaCon: '1000.00',
    };

    it('al conectarse el staff, después del snapshot de pedidos manda llamados:snapshot con las solicitudes de su tenant', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'mozo-1',
        tenantId: TENANT_ID,
        roles: ['MOZO'],
      });
      mockPedidosTransicion.listarSolicitudesEfectivo.mockResolvedValue([
        SOLICITUD,
      ]);
      const client = mockClient();

      await gateway.handleConnection(client as any);

      expect(
        mockPedidosTransicion.listarSolicitudesEfectivo,
      ).toHaveBeenCalledWith(TENANT_ID);
      expect(client.emit.mock.calls.map(([evento]) => evento)).toEqual([
        'pedidos:snapshot',
        'llamados:snapshot',
      ]);
      expect(client.emit).toHaveBeenCalledWith('llamados:snapshot', [
        SOLICITUD,
      ]);
    });

    it('pedidos:sync también reenvía las solicitudes pendientes al salón', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'mozo-1',
        tenantId: TENANT_ID,
        roles: ['MOZO'],
      });
      mockPedidosTransicion.listarSolicitudesEfectivo.mockResolvedValue([
        SOLICITUD,
      ]);
      const client = mockClient();

      await gateway.onSync(client as any);

      expect(client.emit).toHaveBeenCalledWith('llamados:snapshot', [
        SOLICITUD,
      ]);
    });

    it('[BL-460] Cocina recibe los pedidos al conectarse, pero ni consulta ni recibe los avisos de efectivo', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'cocina-1',
        tenantId: TENANT_ID,
        roles: ['COCINA'],
      });
      mockPedidosTransicion.listarSolicitudesEfectivo.mockResolvedValue([
        SOLICITUD,
      ]);
      const client = mockClient();

      await gateway.handleConnection(client as any);

      expect(client.emit).toHaveBeenCalledWith('pedidos:snapshot', []);
      expect(
        mockPedidosTransicion.listarSolicitudesEfectivo,
      ).not.toHaveBeenCalled();
      expect(client.emit.mock.calls.map(([evento]) => evento)).toEqual([
        'pedidos:snapshot',
      ]);
    });

    it('[BL-460] pedidos:sync de Cocina reenvía los pedidos, pero no las solicitudes de efectivo', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'cocina-1',
        tenantId: TENANT_ID,
        roles: ['COCINA'],
      });
      mockPedidosTransicion.listarSolicitudesEfectivo.mockResolvedValue([
        SOLICITUD,
      ]);
      const client = mockClient();

      await gateway.onSync(client as any);

      expect(client.emit).toHaveBeenCalledWith('pedidos:snapshot', []);
      expect(client.emit).not.toHaveBeenCalledWith(
        'llamados:snapshot',
        expect.anything(),
      );
      expect(
        mockPedidosTransicion.listarSolicitudesEfectivo,
      ).not.toHaveBeenCalled();
    });

    it('[BL-460] un usuario con Cocina y Mozo sí recibe las solicitudes de efectivo', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'usuario-mixto',
        tenantId: TENANT_ID,
        roles: ['COCINA', 'MOZO'],
      });
      mockPedidosTransicion.listarSolicitudesEfectivo.mockResolvedValue([
        SOLICITUD,
      ]);
      const client = mockClient();

      await gateway.handleConnection(client as any);

      expect(client.emit).toHaveBeenCalledWith('llamados:snapshot', [
        SOLICITUD,
      ]);
    });

    it('un COMENSAL no recibe las solicitudes del tenant', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'comensal-x',
        tenantId: TENANT_ID,
        roles: ['COMENSAL'],
      });
      const client = mockClient();

      await gateway.handleConnection(client as any);
      await gateway.onSync(client as any);

      expect(
        mockPedidosTransicion.listarSolicitudesEfectivo,
      ).not.toHaveBeenCalled();
    });

    it('emitirLlamadoResuelto saca el aviso de la mesa en la sala del salón', () => {
      gateway.emitirLlamadoResuelto(TENANT_ID, 'mesa-3');

      expect(mockServer.to).toHaveBeenCalledWith(`salon:${TENANT_ID}`);
      expect(mockServer.to).not.toHaveBeenCalledWith(`tenant:${TENANT_ID}`);
      expect(mockServer.emit).toHaveBeenCalledWith('llamado:resuelto', {
        mesaId: 'mesa-3',
      });
    });
  });

  describe('emitirAlertaStock', () => {
    it('[TC-U-341] HU-015: la alerta de stock va solo a la sala de administradores del tenant', () => {
      const alerta = {
        itemId: 'i1',
        nombre: 'Milanesa',
        stockActual: 3,
        umbralAlerta: 5,
        tipo: 'STOCK_CRITICO',
      };

      gateway.emitirAlertaStock(TENANT_ID, alerta);

      expect(mockServer.to).toHaveBeenCalledWith(`admin:${TENANT_ID}`);
      expect(mockServer.emit).toHaveBeenCalledWith('stock:alerta', alerta);
    });
  });

  describe('emitirStockActualizado', () => {
    it('[TC-U-350] HU-015: avisa solo a los administradores que el stock cambió, sin datos', () => {
      gateway.emitirStockActualizado(TENANT_ID);

      expect(mockServer.to).toHaveBeenCalledWith(`admin:${TENANT_ID}`);
      expect(mockServer.emit).toHaveBeenCalledWith('stock:actualizado', {
        ts: expect.any(String),
      });
    });
  });

  describe('emitirReportesActualizados', () => {
    it('[TC-U-310] HU-012: avisa a la sala del tenant que cambió el resumen de ventas, sin datos de ventas', () => {
      gateway.emitirReportesActualizados(TENANT_ID);

      expect(mockServer.to).toHaveBeenCalledWith(`tenant:${TENANT_ID}`);
      expect(mockServer.emit).toHaveBeenCalledWith('reportes:actualizado', {
        ts: expect.any(String),
      });
    });
  });

  describe('emitirEstadoMesa', () => {
    it('emite el cambio de estado de mesa a la sala del tenant', () => {
      gateway.emitirEstadoMesa(TENANT_ID, 'mesa-1', MesaEstado.OCUPADA);

      expect(mockServer.to).toHaveBeenCalledWith(`tenant:${TENANT_ID}`);
      expect(mockServer.emit).toHaveBeenCalledWith(
        'mesa:estado_actualizado',
        expect.objectContaining({
          mesaId: 'mesa-1',
          estado: MesaEstado.OCUPADA,
        }),
      );
    });
  });

  describe('onResolverLlamado', () => {
    it('rol MOZO resuelve el llamado y lo propaga a toda la sala del salón', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'usuario-1',
        tenantId: TENANT_ID,
        roles: ['MOZO'],
      });
      const client = mockClient();

      await gateway.onResolverLlamado(client as any, {
        mesaId: 'mesa-1',
        accion: 'aceptado',
      });

      expect(mockServer.to).toHaveBeenCalledWith(`salon:${TENANT_ID}`);
      expect(mockServer.to).not.toHaveBeenCalledWith(`tenant:${TENANT_ID}`);
      expect(mockServer.emit).toHaveBeenCalledWith('llamado:resuelto', {
        mesaId: 'mesa-1',
        accion: 'aceptado',
      });
    });

    it('rol ADMIN tambien puede resolver el llamado', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'usuario-1',
        tenantId: TENANT_ID,
        roles: ['ADMIN'],
      });
      const client = mockClient();

      await gateway.onResolverLlamado(client as any, {
        mesaId: 'mesa-1',
        accion: 'desestimado',
      });

      expect(mockServer.emit).toHaveBeenCalledWith('llamado:resuelto', {
        mesaId: 'mesa-1',
        accion: 'desestimado',
      });
    });

    it('rol COCINA es rechazado, no propaga la resolucion (RD.06 - solo lectura)', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'usuario-1',
        tenantId: TENANT_ID,
        roles: ['COCINA'],
      });
      const client = mockClient();

      await gateway.onResolverLlamado(client as any, {
        mesaId: 'mesa-1',
        accion: 'aceptado',
      });

      expect(mockServer.to).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Solo Mozo o Administrador pueden resolver un llamado.',
      });
    });

    it('JWT invalido: desconecta en vez de propagar la resolucion', async () => {
      mockWsAuth.verify.mockRejectedValue(
        new WsAuthError('Token invalido o expirado'),
      );
      const client = mockClient();

      await gateway.onResolverLlamado(client as any, {
        mesaId: 'mesa-1',
        accion: 'aceptado',
      });

      expect(mockServer.to).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Sesion invalida o expirada - reconecta.',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('BL-441: un body inválido (sin mesaId o con acción desconocida) se rechaza sin propagar nada', async () => {
      mockWsAuth.verify.mockResolvedValue({
        sub: 'usuario-1',
        tenantId: TENANT_ID,
        roles: ['MOZO'],
      });
      const client = mockClient();

      await gateway.onResolverLlamado(client as any, {
        mesaId: '',
        accion: 'aceptado',
      });
      await gateway.onResolverLlamado(client as any, {
        mesaId: 'mesa-1',
        accion: 'borrar' as any,
      });
      await gateway.onResolverLlamado(client as any, undefined as any);

      expect(mockServer.to).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledTimes(3);
      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Solicitud de alerta inválida.',
      });
    });
  });

  describe('BL-441: alertas que sobreviven al refresco', () => {
    const MOZO = { sub: 'mozo-1', tenantId: TENANT_ID, roles: ['MOZO'] };

    async function conectar() {
      const client = mockClient();
      await gateway.handleConnection(client as any);
      return client;
    }

    function snapshotDe(client: ReturnType<typeof mockClient>) {
      const llamada = client.emit.mock.calls.filter(
        ([evento]) => evento === 'llamados:snapshot',
      );
      return llamada[llamada.length - 1][1];
    }

    beforeEach(() => {
      mockWsAuth.verify.mockResolvedValue(MOZO);
    });

    it('un llamado de mesa sin atender vuelve en el snapshot al reconectar', async () => {
      gateway.emitirLlamado(TENANT_ID, 'mesa-1', 1);

      const client = await conectar();

      expect(snapshotDe(client)).toEqual([
        expect.objectContaining({ mesaId: 'mesa-1', mesaNumero: 1 }),
      ]);
    });

    it('el snapshot viene con la alerta más antigua primero', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() - 60_000);
      gateway.emitirLlamado(TENANT_ID, 'mesa-vieja', 7);
      jest.spyOn(Date, 'now').mockRestore();
      gateway.emitirLlamado(TENANT_ID, 'mesa-nueva', 2);

      const client = await conectar();

      expect(snapshotDe(client).map((a: any) => a.mesaId)).toEqual([
        'mesa-vieja',
        'mesa-nueva',
      ]);
    });

    it('una mesa que vuelve a llamar sigue siendo una sola alerta', async () => {
      gateway.emitirLlamado(TENANT_ID, 'mesa-1', 1);
      gateway.emitirLlamado(TENANT_ID, 'mesa-1', 1);

      const client = await conectar();

      expect(snapshotDe(client)).toHaveLength(1);
    });

    it('al aceptar o desestimar, la alerta no vuelve al reconectar', async () => {
      gateway.emitirLlamado(TENANT_ID, 'mesa-1', 1);
      gateway.emitirLlamado(TENANT_ID, 'mesa-2', 2);
      await gateway.onResolverLlamado(mockClient() as any, {
        mesaId: 'mesa-1',
        accion: 'aceptado',
      });
      await gateway.onResolverLlamado(mockClient() as any, {
        mesaId: 'mesa-2',
        accion: 'desestimado',
      });

      const client = await conectar();

      expect(snapshotDe(client)).toEqual([]);
    });

    it('un aviso de efectivo aceptado (guardado) no vuelve aunque siga en la base', async () => {
      const efectivo = {
        pedidoId: 'pedido-1',
        total: '250.00',
        pagaCon: '1000.00',
      };
      gateway.emitirLlamado(TENANT_ID, 'mesa-3', 3, efectivo);
      mockPedidosTransicion.listarSolicitudesEfectivo.mockResolvedValue([
        {
          mesaId: 'mesa-3',
          mesaNumero: 3,
          ts: 1,
          motivo: 'PAGO_EFECTIVO',
          ...efectivo,
        },
      ]);
      await gateway.onResolverLlamado(mockClient() as any, {
        mesaId: 'mesa-3',
        accion: 'aceptado',
      });

      const client = await conectar();

      expect(snapshotDe(client)).toEqual([]);
    });

    it('un aviso de efectivo que solo está en la base (el servidor se reinició) también se anota como atendido', async () => {
      const solicitud = {
        mesaId: 'mesa-3',
        mesaNumero: 3,
        ts: Date.now(),
        motivo: 'PAGO_EFECTIVO',
        pedidoId: 'pedido-1',
        total: '250.00',
        pagaCon: null,
      };
      mockPedidosTransicion.listarSolicitudesEfectivo.mockResolvedValue([
        solicitud,
      ]);

      await gateway.onResolverLlamado(mockClient() as any, {
        mesaId: 'mesa-3',
        accion: 'aceptado',
      });
      const client = await conectar();

      expect(snapshotDe(client)).toEqual([]);
    });

    it('si falla la consulta del efectivo al resolver, igual se propaga la resolución', async () => {
      mockPedidosTransicion.listarSolicitudesEfectivo.mockRejectedValue(
        new Error('base caída'),
      );

      await gateway.onResolverLlamado(mockClient() as any, {
        mesaId: 'mesa-1',
        accion: 'aceptado',
      });

      expect(mockServer.emit).toHaveBeenCalledWith('llamado:resuelto', {
        mesaId: 'mesa-1',
        accion: 'aceptado',
      });
    });

    it('cerrar la mesa saca la alerta y no vuelve al reconectar', async () => {
      gateway.emitirLlamado(TENANT_ID, 'mesa-1', 1);

      gateway.emitirLlamadoResuelto(TENANT_ID, 'mesa-1');
      const client = await conectar();

      expect(snapshotDe(client)).toEqual([]);
    });

    it('cuando llega pedido:nuevo del pedido cobrado, su aviso de efectivo se saca', async () => {
      gateway.emitirLlamado(TENANT_ID, 'mesa-3', 3, {
        pedidoId: 'pedido-1',
        total: '250.00',
        pagaCon: null,
      });

      gateway.emitirNuevoPedido(TENANT_ID, { id: 'pedido-1' });
      const client = await conectar();

      expect(snapshotDe(client)).toEqual([]);
    });

    it('emitirNuevoPedido tolera un pedido sin id', () => {
      expect(() => gateway.emitirNuevoPedido(TENANT_ID, null)).not.toThrow();
      expect(() => gateway.emitirNuevoPedido(TENANT_ID, {})).not.toThrow();
    });

    it('las alertas de un establecimiento no aparecen en el de otro', async () => {
      gateway.emitirLlamado(TENANT_ID_AJENO, 'mesa-ajena', 9);

      const client = await conectar();

      expect(snapshotDe(client)).toEqual([]);
    });

    it('pedidos:sync también devuelve las alertas guardadas', async () => {
      gateway.emitirLlamado(TENANT_ID, 'mesa-1', 1);
      const client = mockClient();

      await gateway.onSync(client as any);

      expect(snapshotDe(client)).toEqual([
        expect.objectContaining({ mesaId: 'mesa-1' }),
      ]);
    });
  });
});
