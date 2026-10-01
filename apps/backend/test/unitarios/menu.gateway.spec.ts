import { Test, TestingModule } from '@nestjs/testing';
import { MenuGateway } from '../../src/menu/menu.gateway';

describe('MenuGateway', () => {
  let gateway: MenuGateway;
  let mockServer: any;
  let mockEmit: jest.Mock;

  beforeEach(async () => {
    mockEmit = jest.fn();
    mockServer = {
      to: jest.fn().mockReturnValue({ emit: mockEmit }),
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

  describe('emitItemUpdated', () => {
    it('should emit menu:item:updated to the correct tenant room', () => {
      const payload = { itemId: 'item-1', disponible: false };
      gateway.emitItemUpdated('tenant-1', payload);

      expect(mockServer.to).toHaveBeenCalledWith('tenant_tenant-1');
      expect(mockEmit).toHaveBeenCalledWith('menu:item:updated', payload);
    });
  });

  describe('emitCategoriaUpdated', () => {
    it('should emit menu:categoria:updated to the correct tenant room', () => {
      const payload = { categoriaId: 'cat-1', activo: false };
      gateway.emitCategoriaUpdated('tenant-1', payload);

      expect(mockServer.to).toHaveBeenCalledWith('tenant_tenant-1');
      expect(mockEmit).toHaveBeenCalledWith('menu:categoria:updated', payload);
    });
  });
});
