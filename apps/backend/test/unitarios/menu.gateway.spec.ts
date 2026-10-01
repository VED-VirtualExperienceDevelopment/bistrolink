import { Test, TestingModule } from '@nestjs/testing';
import { MenuGateway } from '../../src/menu/menu.gateway';

describe('MenuGateway', () => {
  let gateway: MenuGateway;
  let mockServer: any;

  beforeEach(async () => {
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [MenuGateway],
    }).compile();

    gateway = module.get<MenuGateway>(MenuGateway);
    gateway.server = mockServer;
  });

  describe('emitItemUpdated', () => {
    it('debe emitir evento menu:item:updated con el payload correcto', () => {
      const tenantId = 'test-tenant-id';
      const payload = { itemId: 'item-123', disponible: true };

      gateway.emitItemUpdated(tenantId, payload);

      expect(mockServer.to).toHaveBeenCalledWith(`tenant_${tenantId}`);
      expect(mockServer.emit).toHaveBeenCalledWith(
        'menu:item:updated',
        payload,
      );
    });
  });

  describe('emitCategoriaUpdated', () => {
    it('debe emitir evento menu:categoria:updated con el payload correcto', () => {
      const tenantId = 'test-tenant-id';
      const payload = { categoriaId: 'cat-123', activo: false };

      gateway.emitCategoriaUpdated(tenantId, payload);

      expect(mockServer.to).toHaveBeenCalledWith(`tenant_${tenantId}`);
      expect(mockServer.emit).toHaveBeenCalledWith(
        'menu:categoria:updated',
        payload,
      );
    });
  });

  describe('emitItemDataUpdated', () => {
    it('debe emitir evento menu:item:data:updated con el payload correcto', () => {
      const tenantId = 'test-tenant-id';
      const payload = {
        itemId: 'item-123',
        data: { nombre: 'Pizza', precio: '10.50' },
      };

      gateway.emitItemDataUpdated(tenantId, payload);

      expect(mockServer.to).toHaveBeenCalledWith(`tenant_${tenantId}`);
      expect(mockServer.emit).toHaveBeenCalledWith(
        'menu:item:data:updated',
        payload,
      );
    });

    it('debe emitir evento con datos completos del ítem', () => {
      const tenantId = 'tenant-abc';
      const payload = {
        itemId: 'item-456',
        data: {
          id: 'item-456',
          nombre: 'Hamburguesa',
          precio: '15.00',
          disponible: true,
          tenantId: 'tenant-abc',
        },
      };

      gateway.emitItemDataUpdated(tenantId, payload);

      expect(mockServer.to).toHaveBeenCalledWith(`tenant_${tenantId}`);
      expect(mockServer.emit).toHaveBeenCalledWith(
        'menu:item:data:updated',
        payload,
      );
    });
  });

  describe('handleConnection', () => {
    it('debe unir al cliente a la room del tenant si tenantId está presente', () => {
      const mockClient = {
        id: 'client-123',
        handshake: {
          query: { tenantId: 'test-tenant' },
        },
        join: jest.fn(),
      };

      gateway.handleConnection(mockClient as any);

      expect(mockClient.join).toHaveBeenCalledWith('tenant_test-tenant');
    });

    it('no debe unir al cliente si tenantId no está presente', () => {
      const mockClient = {
        id: 'client-456',
        handshake: {
          query: {},
        },
        join: jest.fn(),
      };

      gateway.handleConnection(mockClient as any);

      expect(mockClient.join).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('debe manejar la desconexión del cliente sin errores', () => {
      const mockClient = {
        id: 'client-789',
      };

      expect(() => gateway.handleDisconnect(mockClient as any)).not.toThrow();
    });
  });
});
