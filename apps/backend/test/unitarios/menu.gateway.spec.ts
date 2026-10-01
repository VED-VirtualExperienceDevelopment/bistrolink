import { Test, TestingModule } from '@nestjs/testing';
import { MenuGateway } from '../../src/menu/menu.gateway';
import { Logger } from '@nestjs/common';

describe('MenuGateway', () => {
  let gateway: MenuGateway;
  let mockServer: any;
  let mockEmit: jest.Mock;
  let mockJoin: jest.Mock;
  let mockTo: jest.Mock;

  beforeEach(async () => {
    mockEmit = jest.fn();
    mockJoin = jest.fn();
    mockTo = jest.fn().mockReturnValue({ emit: mockEmit });

    mockServer = {
      to: mockTo,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [MenuGateway],
    }).compile();

    gateway = module.get<MenuGateway>(MenuGateway);
    gateway.server = mockServer;
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('should join tenant room when tenantId is provided', () => {
      const mockClient = {
        id: 'client-123',
        handshake: {
          query: {
            tenantId: 'tenant-456',
          },
        },
        join: mockJoin,
      };

      gateway.handleConnection(mockClient as any);

      expect(mockJoin).toHaveBeenCalledWith('tenant_tenant-456');
    });

    it('should not join room when tenantId is not provided', () => {
      const mockClient = {
        id: 'client-123',
        handshake: {
          query: {},
        },
        join: mockJoin,
      };

      gateway.handleConnection(mockClient as any);

      expect(mockJoin).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('should log when client disconnects', () => {
      const mockClient = {
        id: 'client-123',
      };

      const loggerSpy = jest.spyOn((gateway as any).logger, 'log');

      gateway.handleDisconnect(mockClient as any);

      expect(loggerSpy).toHaveBeenCalledWith('Cliente desconectado: client-123');
    });
  });

  describe('emitItemUpdated', () => {
    it('should emit menu:item:updated to the correct tenant room', () => {
      const payload = { itemId: 'item-1', disponible: false };
      gateway.emitItemUpdated('tenant-1', payload);

      expect(mockTo).toHaveBeenCalledWith('tenant_tenant-1');
      expect(mockEmit).toHaveBeenCalledWith('menu:item:updated', payload);
    });
  });

  describe('emitCategoriaUpdated', () => {
    it('should emit menu:categoria:updated to the correct tenant room', () => {
      const payload = { categoriaId: 'cat-1', activo: false };
      gateway.emitCategoriaUpdated('tenant-1', payload);

      expect(mockTo).toHaveBeenCalledWith('tenant_tenant-1');
      expect(mockEmit).toHaveBeenCalledWith('menu:categoria:updated', payload);
    });
  });
});
