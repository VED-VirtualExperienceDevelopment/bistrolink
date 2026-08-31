import { PedidoEstado } from '@prisma/client';
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
    transicionar: jest.Mock;
  };
  let mockModuleRef: { resolve: jest.Mock };

  beforeEach(() => {
    mockPedidosTransicion = {
      listarPendientes: jest.fn().mockResolvedValue([]),
      transicionar: jest.fn(),
    };
    mockModuleRef = {
      resolve: jest.fn().mockResolvedValue(mockPedidosTransicion),
    };
    mockWsAuth = { verify: jest.fn() };

    // Ya no toma cero argumentos: el gateway resuelve WsAuthService por
    // constructor normal, y PedidosTransicionService via ModuleRef (ver
    // comentario en kds.gateway.ts sobre el scope REQUEST de
    // TenantPrismaService).
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
      // Cubre la rama fallback: no todo lo que puede fallar en verify() es
      // necesariamente un WsAuthError (ej. un error de red al pedir la
      // clave publica que no se haya envuelto correctamente). El cliente
      // no deberia ver el detalle interno de ese error.
      mockWsAuth.verify.mockRejectedValue(new Error('fallo de red inesperado'));
      const client = mockClient();

      await gateway.handleConnection(client as any);

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'No autorizado',
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
      // Sin broadcast a la sala si la transicion nunca se aplico.
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
});
