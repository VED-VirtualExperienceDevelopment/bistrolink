import { Test, TestingModule } from '@nestjs/testing';
import {
  datosItemParaPantalla,
  MenuGateway,
} from '../../src/menu/menu.gateway';
import { WsAuthError, WsAuthService } from '../../src/pedidos/ws-auth.service';

describe('MenuGateway', () => {
  let gateway: MenuGateway;
  let mockServer: any;
  const wsAuth = { verify: jest.fn() };

  beforeEach(async () => {
    wsAuth.verify.mockReset();
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [MenuGateway, { provide: WsAuthService, useValue: wsAuth }],
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

    it('[TC-U-561] BL-515: solo manda los campos de la pantalla, sin tenant, stock ni clave de imagen', () => {
      gateway.emitItemDataUpdated('tenant-abc', {
        itemId: 'item-456',
        data: {
          id: 'item-456',
          tenantId: 'tenant-abc',
          categoriaId: 'cat-1',
          nombre: 'Hamburguesa',
          precio: '15.00',
          disponible: true,
          destacado: false,
          controlaStock: true,
          stockActual: 7,
          umbralAlerta: 5,
          imagenKey: 'tenant-abc/menu/x.webp',
          archivadoEn: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      expect(mockServer.emit).toHaveBeenCalledWith('menu:item:data:updated', {
        itemId: 'item-456',
        data: {
          id: 'item-456',
          categoriaId: 'cat-1',
          nombre: 'Hamburguesa',
          precio: '15.00',
          disponible: true,
          destacado: false,
        },
      });
    });

    it('datosItemParaPantalla no agrega campos que no vinieron', () => {
      expect(
        datosItemParaPantalla({ destacado: true, stockActual: 3 }),
      ).toEqual({ destacado: true });
    });
  });

  describe('emitItemRetirado (BL-394)', () => {
    it('[TC-U-211] emite menu:item:retirado a la room del tenant', () => {
      const tenantId = 'test-tenant-id';
      const payload = { itemId: 'item-123' };

      gateway.emitItemRetirado(tenantId, payload);

      expect(mockServer.to).toHaveBeenCalledWith(`tenant_${tenantId}`);
      expect(mockServer.emit).toHaveBeenCalledWith(
        'menu:item:retirado',
        payload,
      );
    });
  });

  describe('emitCategoriaRetirada (BL-394)', () => {
    it('[TC-U-211] emite menu:categoria:retirada a la room del tenant', () => {
      const tenantId = 'test-tenant-id';
      const payload = { categoriaId: 'cat-123' };

      gateway.emitCategoriaRetirada(tenantId, payload);

      expect(mockServer.to).toHaveBeenCalledWith(`tenant_${tenantId}`);
      expect(mockServer.emit).toHaveBeenCalledWith(
        'menu:categoria:retirada',
        payload,
      );
    });
  });

  describe('emitCartaReordenada (BL-399)', () => {
    it('[TC-U-253] emite menu:carta:reordenada a la room del tenant', () => {
      gateway.emitCartaReordenada('test-tenant-id');

      expect(mockServer.to).toHaveBeenCalledWith('tenant_test-tenant-id');
      expect(mockServer.emit).toHaveBeenCalledWith('menu:carta:reordenada', {});
    });
  });

  describe('autenticación de la conexión (BL-515)', () => {
    const ADMIN = {
      sub: 'u-1',
      tenantId: 'tenant-del-token',
      roles: ['ADMIN'],
    };

    function socketCon(auth: Record<string, unknown>, query = {}) {
      return {
        id: 'client-1',
        handshake: { auth, query },
        data: {} as Record<string, unknown>,
        join: jest.fn(),
        disconnect: jest.fn(),
      };
    }

    it('[TC-U-557] sin token: rechaza la conexión y no guarda usuario', async () => {
      wsAuth.verify.mockRejectedValue(
        new WsAuthError('Token no provisto en el handshake'),
      );
      const socket = socketCon({});

      await expect(gateway.autenticar(socket as any)).rejects.toThrow(
        'Token no provisto en el handshake',
      );
      expect(wsAuth.verify).toHaveBeenCalledWith(undefined);
      expect(socket.data.user).toBeUndefined();
    });

    it('[TC-U-558] token inválido o error inesperado: rechaza la conexión', async () => {
      wsAuth.verify.mockRejectedValueOnce(
        new WsAuthError('Token inválido o expirado'),
      );
      await expect(
        gateway.autenticar(socketCon({ token: 'malo' }) as any),
      ).rejects.toThrow('Token inválido o expirado');

      wsAuth.verify.mockRejectedValueOnce(new Error('falla interna'));
      await expect(
        gateway.autenticar(socketCon({ token: 'x' }) as any),
      ).rejects.toThrow('No autorizado');
    });

    it('[TC-U-559] un rol que no es ADMIN se rechaza', async () => {
      wsAuth.verify.mockResolvedValue({ ...ADMIN, roles: ['MOZO'] });
      const socket = socketCon({ token: 'tok' });

      await expect(gateway.autenticar(socket as any)).rejects.toThrow(
        'Rol no autorizado para este canal.',
      );
      expect(socket.data.user).toBeUndefined();
    });

    it('[TC-U-560] un ADMIN entra a la sala del tenant del token aunque mande otro tenantId en el query', async () => {
      wsAuth.verify.mockResolvedValue(ADMIN);
      const socket = socketCon({ token: 'tok' }, { tenantId: 'tenant-ajeno' });

      await gateway.autenticar(socket as any);
      await gateway.handleConnection(socket as any);

      expect(socket.join).toHaveBeenCalledWith('tenant_tenant-del-token');
      expect(socket.join).not.toHaveBeenCalledWith('tenant_tenant-ajeno');
    });

    it('una conexión que llega sin usuario autenticado se corta', async () => {
      const socket = socketCon({});
      await gateway.handleConnection(socket as any);
      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('afterInit registra el middleware: acepta o rechaza con next', async () => {
      let middleware: (s: unknown, next: (e?: Error) => void) => void = () =>
        undefined;
      gateway.afterInit({
        use: (fn: typeof middleware) => (middleware = fn),
      } as any);

      wsAuth.verify.mockResolvedValueOnce(ADMIN);
      const ok = await new Promise<Error | undefined>((resolve) =>
        middleware(socketCon({ token: 'tok' }), resolve),
      );
      expect(ok).toBeUndefined();

      wsAuth.verify.mockRejectedValueOnce(
        new WsAuthError('Token inválido o expirado'),
      );
      const error = await new Promise<Error | undefined>((resolve) =>
        middleware(socketCon({ token: 'malo' }), resolve),
      );
      expect(error?.message).toBe('Token inválido o expirado');
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
