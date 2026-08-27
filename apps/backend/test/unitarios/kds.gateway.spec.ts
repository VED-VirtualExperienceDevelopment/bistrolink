import { KdsGateway } from '../../src/pedidos/kds.gateway';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID_AJENO = 'aaaaaaaa-0000-0000-0000-000000000001';

describe('KdsGateway', () => {
  let gateway: KdsGateway;
  let mockServer: { to: jest.Mock; emit: jest.Mock };

  beforeEach(() => {
    gateway = new KdsGateway();

    mockServer = { to: jest.fn(), emit: jest.fn() };
    mockServer.to.mockReturnValue({ emit: mockServer.emit });
    gateway.server = mockServer as any;
  });

  it('handleConnection y handleDisconnect no explotan (solo loguean)', () => {
    const mockClient = { id: 'socket-123' } as any;

    expect(() => gateway.handleConnection(mockClient)).not.toThrow();
    expect(() => gateway.handleDisconnect(mockClient)).not.toThrow();
  });

  it('handleJoinTenant une al cliente a la sala scopeada de SU tenant', () => {
    const mockClient = { join: jest.fn() } as any;

    gateway.handleJoinTenant(mockClient, TENANT_ID);

    expect(mockClient.join).toHaveBeenCalledWith(`tenant:${TENANT_ID}`);
  });

  it('emitirNuevoPedido emite solo a la sala del tenant correspondiente', () => {
    const pedido = { id: 'pedido-1', tenantId: TENANT_ID };

    gateway.emitirNuevoPedido(TENANT_ID, pedido);

    expect(mockServer.to).toHaveBeenCalledWith(`tenant:${TENANT_ID}`);
    expect(mockServer.emit).toHaveBeenCalledWith('pedido:nuevo', pedido);
  });

  it('dos tenants distintos arman nombres de sala distintos — nunca se pisan', () => {
    gateway.emitirNuevoPedido(TENANT_ID, { id: 'pedido-a' });
    gateway.emitirNuevoPedido(TENANT_ID_AJENO, { id: 'pedido-b' });

    expect(mockServer.to).toHaveBeenNthCalledWith(1, `tenant:${TENANT_ID}`);
    expect(mockServer.to).toHaveBeenNthCalledWith(
      2,
      `tenant:${TENANT_ID_AJENO}`,
    );
  });
});
