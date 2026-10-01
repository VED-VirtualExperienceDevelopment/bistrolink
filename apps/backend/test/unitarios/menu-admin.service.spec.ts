import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MenuAdminService } from '../../src/menu/menu-admin.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { MenuGateway } from '../../src/menu/menu.gateway';

describe('MenuAdminService', () => {
  let service: MenuAdminService;
  let prismaMock: any;
  let gatewayMock: any;

  const mockTx = () => ({
    usuario: { findFirst: jest.fn() },
    categoriaCarta: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    itemCarta: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  });

  beforeEach(async () => {
    const tx = mockTx();
    prismaMock = {
      runInTenantContext: jest.fn((_tenantId: string, callback: any) => callback(tx)),
    };
    gatewayMock = {
      emitItemUpdated: jest.fn(),
      emitCategoriaUpdated: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuAdminService,
        { provide: TenantPrismaService, useValue: prismaMock },
        { provide: MenuGateway, useValue: gatewayMock },
      ],
    }).compile();

    service = module.get<MenuAdminService>(MenuAdminService);
  });

  describe('findAllCategorias', () => {
    it('should return categorias when restauranteId is provided', async () => {
      const mockCategorias = [{ id: 'cat-1', nombre: 'Test' }];
      prismaMock.runInTenantContext.mockImplementation((_tenantId: string, callback: any) =>
        callback({ categoriaCarta: { findMany: jest.fn().mockResolvedValue(mockCategorias) } }),
      );

      const result = await service.findAllCategorias('tenant-1', 'rest-123', 'user-keycloak-id');
      expect(result).toEqual(mockCategorias);
    });

    it('should throw UnauthorizedException when restauranteId cannot be resolved', async () => {
      prismaMock.runInTenantContext.mockImplementation((_tenantId: string, callback: any) =>
        callback({ usuario: { findFirst: jest.fn().mockResolvedValue(null) } }),
      );

      await expect(service.findAllCategorias('tenant-1', undefined, 'user-keycloak-id')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('createCategoria', () => {
    it('should create a categoria successfully', async () => {
      const mockCategoria = { id: 'cat-1', nombre: 'Test', orden: 1 };
      prismaMock.runInTenantContext.mockImplementation((_tenantId: string, callback: any) =>
        callback({
          usuario: { findFirst: jest.fn().mockResolvedValue({ restauranteId: 'rest-123' }) },
          categoriaCarta: { create: jest.fn().mockResolvedValue(mockCategoria) },
        }),
      );

      const result = await service.createCategoria('tenant-1', undefined, 'user-keycloak-id', { nombre: 'Test', orden: 1 });
      expect(result.nombre).toBe('Test');
    });

    it('should throw UnauthorizedException when restauranteId cannot be resolved', async () => {
      prismaMock.runInTenantContext.mockImplementation((_tenantId: string, callback: any) =>
        callback({ usuario: { findFirst: jest.fn().mockResolvedValue(null) } }),
      );

      await expect(service.createCategoria('tenant-1', undefined, 'user-keycloak-id', { nombre: 'Test' })).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('updateCategoria', () => {
    it('should update a categoria successfully', async () => {
      const existing = { id: 'cat-1', nombre: 'Test', activo: true };
      const updated = { id: 'cat-1', nombre: 'Test', activo: false };

      prismaMock.runInTenantContext.mockImplementation((_tenantId: string, callback: any) =>
        callback({
          categoriaCarta: { findFirst: jest.fn().mockResolvedValue(existing), update: jest.fn().mockResolvedValue(updated) },
        }),
      );

      const result = await service.updateCategoria('tenant-1', 'cat-1', { activo: false });
      expect(result.activo).toBe(false);
      expect(gatewayMock.emitCategoriaUpdated).toHaveBeenCalledWith('tenant-1', { categoriaId: 'cat-1', activo: false });
    });

    it('should throw NotFoundException when categoria does not exist', async () => {
      prismaMock.runInTenantContext.mockImplementation((_tenantId: string, callback: any) =>
        callback({ categoriaCarta: { findFirst: jest.fn().mockResolvedValue(null) } }),
      );

      await expect(service.updateCategoria('tenant-1', 'invalid-id', { activo: true })).rejects.toThrow(NotFoundException);
    });
  });

  describe('createItem', () => {
    it('should create an item successfully', async () => {
      const mockItem = { id: 'item-1', nombre: 'Test', precio: '10.00' };
      prismaMock.runInTenantContext.mockImplementation((_tenantId: string, callback: any) =>
        callback({
          categoriaCarta: { findFirst: jest.fn().mockResolvedValue({ id: 'cat-1' }) },
          itemCarta: { create: jest.fn().mockResolvedValue(mockItem) },
        }),
      );

      const result = await service.createItem('tenant-1', { categoriaId: 'cat-1', nombre: 'Test', precio: '10.00' });
      expect(result.nombre).toBe('Test');
    });

    it('should throw NotFoundException when categoria does not exist', async () => {
      prismaMock.runInTenantContext.mockImplementation((_tenantId: string, callback: any) =>
        callback({ categoriaCarta: { findFirst: jest.fn().mockResolvedValue(null) } }),
      );

      await expect(service.createItem('tenant-1', { categoriaId: 'invalid', nombre: 'Test', precio: '10.00' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateItem', () => {
    it('should update an item successfully', async () => {
      const existing = { id: 'item-1', nombre: 'Test', disponible: true };
      const updated = { id: 'item-1', nombre: 'Test', disponible: false };

      prismaMock.runInTenantContext.mockImplementation((_tenantId: string, callback: any) =>
        callback({
          itemCarta: { findFirst: jest.fn().mockResolvedValue(existing), update: jest.fn().mockResolvedValue(updated) },
        }),
      );

      const result = await service.updateItem('tenant-1', 'item-1', { disponible: false });
      expect(result.disponible).toBe(false);
      expect(gatewayMock.emitItemUpdated).toHaveBeenCalledWith('tenant-1', { itemId: 'item-1', disponible: false });
    });

    it('should throw NotFoundException when item does not exist', async () => {
      prismaMock.runInTenantContext.mockImplementation((_tenantId: string, callback: any) =>
        callback({ itemCarta: { findFirst: jest.fn().mockResolvedValue(null) } }),
      );

      await expect(service.updateItem('tenant-1', 'invalid-id', { disponible: false })).rejects.toThrow(NotFoundException);
    });
  });
});
