import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { MenuAdminService } from '../../src/menu/menu-admin.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { MenuGateway } from '../../src/menu/menu.gateway';
import { StorageService } from '../../src/menu/storage.service';
import { CreateItemDto } from '../../src/menu/dto/create-item.dto';
import { UpdateItemDto } from '../../src/menu/dto/update-item.dto';
import { UpdateCategoriaDto } from '../../src/menu/dto/update-categoria.dto';

const URL_FIRMADA = 'https://bucket.example/img.jpg?X-Amz-Signature=abc';

describe('MenuAdminService', () => {
  let service: MenuAdminService;

  const mockTx = {
    categoriaCarta: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    itemCarta: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    usuario: {
      findFirst: jest.fn(),
    },
  };

  const mockPrismaService = {
    runInTenantContext: jest.fn().mockImplementation((tenantId, callback) => {
      return callback(mockTx);
    }),
  };

  const mockMenuGateway = {
    emitItemUpdated: jest.fn(),
    emitCategoriaUpdated: jest.fn(),
    emitItemDataUpdated: jest.fn(),
  };

  const mockStorage = {
    getSignedImageUrl: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuAdminService,
        {
          provide: TenantPrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: MenuGateway,
          useValue: mockMenuGateway,
        },
        {
          provide: StorageService,
          useValue: mockStorage,
        },
      ],
    }).compile();

    service = module.get<MenuAdminService>(MenuAdminService);

    jest.clearAllMocks();
    // clearAllMocks no resetea implementaciones: se fija acá en cada test
    // para que un mockResolvedValue(null) de un test no se filtre al siguiente.
    mockStorage.getSignedImageUrl.mockResolvedValue(URL_FIRMADA);
  });

  describe('createItem', () => {
    const tenantId = 'test-tenant-id';
    const createItemDto: CreateItemDto = {
      categoriaId: 'cat-123',
      nombre: 'Pizza Margherita',
      precio: '12.50',
      descripcion: 'Pizza clásica',
      disponible: true,
    };

    it('debe crear un ítem exitosamente y emitir evento WebSocket', async () => {
      const mockCategoria = { id: 'cat-123', nombre: 'Pizzas', tenantId };
      const mockItem = {
        id: 'item-123',
        ...createItemDto,
        tenantId,
        disponible: true,
      };

      mockTx.categoriaCarta.findFirst.mockResolvedValue(mockCategoria);
      mockTx.itemCarta.create.mockResolvedValue(mockItem);

      const result = await service.createItem(tenantId, createItemDto);

      expect(result).toEqual(mockItem);
      expect(mockTx.categoriaCarta.findFirst).toHaveBeenCalledWith({
        where: { id: createItemDto.categoriaId, tenantId },
      });
      expect(mockTx.itemCarta.create).toHaveBeenCalledWith({
        data: {
          ...createItemDto,
          tenantId,
          disponible: true,
        },
      });
      expect(mockMenuGateway.emitItemDataUpdated).toHaveBeenCalledWith(
        tenantId,
        {
          itemId: mockItem.id,
          data: mockItem,
        },
      );
    });

    it('debe lanzar NotFoundException si la categoría no existe', async () => {
      mockTx.categoriaCarta.findFirst.mockResolvedValue(null);

      await expect(service.createItem(tenantId, createItemDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.createItem(tenantId, createItemDto)).rejects.toThrow(
        'La categoría especificada no existe o no pertenece a este tenant',
      );
    });

    it('debe usar disponible=true por defecto si no se especifica', async () => {
      const dtoSinDisponible = { ...createItemDto };
      delete (dtoSinDisponible as any).disponible;

      const mockCategoria = { id: 'cat-123', nombre: 'Pizzas', tenantId };
      const mockItem = {
        id: 'item-123',
        ...dtoSinDisponible,
        tenantId,
        disponible: true,
      };

      mockTx.categoriaCarta.findFirst.mockResolvedValue(mockCategoria);
      mockTx.itemCarta.create.mockResolvedValue(mockItem);

      await service.createItem(tenantId, dtoSinDisponible);

      expect(mockTx.itemCarta.create).toHaveBeenCalledWith({
        data: {
          ...dtoSinDisponible,
          tenantId,
          disponible: true,
        },
      });
    });
  });

  describe('updateItem', () => {
    const tenantId = 'test-tenant-id';
    const itemId = 'item-123';
    const updateItemDto: UpdateItemDto = {
      nombre: 'Pizza Margherita Actualizada',
      precio: '13.00',
    };

    it('debe actualizar un ítem exitosamente y emitir evento WebSocket', async () => {
      const mockExisting = {
        id: itemId,
        categoriaId: 'cat-123',
        nombre: 'Pizza Margherita',
        precio: '12.50',
        tenantId,
      };
      const mockUpdated = {
        ...mockExisting,
        ...updateItemDto,
      };

      mockTx.itemCarta.findFirst.mockResolvedValue(mockExisting);
      mockTx.itemCarta.update.mockResolvedValue(mockUpdated);

      const result = await service.updateItem(tenantId, itemId, updateItemDto);

      expect(result).toEqual(mockUpdated);
      expect(mockTx.itemCarta.findFirst).toHaveBeenCalledWith({
        where: { id: itemId, tenantId },
      });
      expect(mockTx.itemCarta.update).toHaveBeenCalledWith({
        where: { id: itemId },
        data: updateItemDto,
      });
      expect(mockMenuGateway.emitItemDataUpdated).toHaveBeenCalledWith(
        tenantId,
        {
          itemId,
          data: mockUpdated,
        },
      );
    });

    it('debe lanzar NotFoundException si el ítem no existe', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(null);

      await expect(
        service.updateItem(tenantId, itemId, updateItemDto),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.updateItem(tenantId, itemId, updateItemDto),
      ).rejects.toThrow('Ítem no encontrado o no pertenece a este tenant');
    });

    it('debe validar que la nueva categoría existe si se cambia', async () => {
      const dtoConNuevaCategoria: UpdateItemDto = {
        ...updateItemDto,
        categoriaId: 'cat-456',
      };

      const mockExisting = {
        id: itemId,
        categoriaId: 'cat-123',
        tenantId,
      };

      mockTx.itemCarta.findFirst.mockResolvedValue(mockExisting);
      mockTx.categoriaCarta.findFirst.mockResolvedValue(null);

      await expect(
        service.updateItem(tenantId, itemId, dtoConNuevaCategoria),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.updateItem(tenantId, itemId, dtoConNuevaCategoria),
      ).rejects.toThrow(
        'La nueva categoría no existe o no pertenece a este tenant',
      );
    });

    it('no debe validar categoría si no se cambia', async () => {
      const mockExisting = {
        id: itemId,
        categoriaId: 'cat-123',
        tenantId,
        nombre: 'Pizza',
        precio: '10.00',
      };
      const mockUpdated = {
        ...mockExisting,
        ...updateItemDto,
      };

      mockTx.itemCarta.findFirst.mockResolvedValue(mockExisting);
      mockTx.itemCarta.update.mockResolvedValue(mockUpdated);

      await service.updateItem(tenantId, itemId, updateItemDto);

      expect(mockTx.itemCarta.findFirst).toHaveBeenCalledTimes(1);
      expect(mockTx.categoriaCarta.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('deleteItem', () => {
    const tenantId = 'test-tenant-id';
    const itemId = 'item-123';

    it('debe realizar un soft delete (disponible: false) y emitir evento WebSocket', async () => {
      const mockExisting = {
        id: itemId,
        nombre: 'Pizza',
        disponible: true,
        tenantId,
      };
      const mockDeleted = { ...mockExisting, disponible: false };

      mockTx.itemCarta.findFirst.mockResolvedValue(mockExisting);
      mockTx.itemCarta.update.mockResolvedValue(mockDeleted);

      const result = await service.deleteItem(tenantId, itemId);

      expect(result.disponible).toBe(false);
      expect(mockTx.itemCarta.update).toHaveBeenCalledWith({
        where: { id: itemId },
        data: { disponible: false },
      });
      expect(mockMenuGateway.emitItemUpdated).toHaveBeenCalledWith(tenantId, {
        itemId,
        disponible: false,
      });
    });

    it('debe lanzar NotFoundException si el ítem no existe', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(null);

      await expect(service.deleteItem(tenantId, itemId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.deleteItem(tenantId, itemId)).rejects.toThrow(
        'Ítem no encontrado o no pertenece a este tenant',
      );
    });
  });

  describe('findAllCategorias', () => {
    const tenantId = 'test-tenant-id';
    const restauranteId = 'rest-123';
    const keycloakId = 'user-123';

    it('debe devolver todas las categorías con sus ítems', async () => {
      const mockCategorias = [
        {
          id: 'cat-1',
          nombre: 'Pizzas',
          items: [{ id: 'item-1', nombre: 'Pizza 1' }],
        },
        {
          id: 'cat-2',
          nombre: 'Bebidas',
          items: [{ id: 'item-2', nombre: 'Coca Cola' }],
        },
      ];

      mockTx.categoriaCarta.findMany.mockResolvedValue(mockCategorias);

      const result = await service.findAllCategorias(
        tenantId,
        restauranteId,
        keycloakId,
      );

      // BL-257: cada ítem trae imagenUrl (null si no tiene imagenKey).
      expect(result).toEqual([
        {
          id: 'cat-1',
          nombre: 'Pizzas',
          items: [{ id: 'item-1', nombre: 'Pizza 1', imagenUrl: null }],
        },
        {
          id: 'cat-2',
          nombre: 'Bebidas',
          items: [{ id: 'item-2', nombre: 'Coca Cola', imagenUrl: null }],
        },
      ]);

      expect(mockTx.categoriaCarta.findMany).toHaveBeenCalledWith({
        where: { restauranteId },
        include: {
          items: {
            orderBy: { nombre: 'asc' },
          },
        },
        orderBy: { orden: 'asc' },
      });
    });

    it('devuelve imagenUrl firmada solo para los ítems con imagenKey (BL-257)', async () => {
      mockTx.categoriaCarta.findMany.mockResolvedValue([
        {
          id: 'cat-1',
          nombre: 'Postres',
          items: [
            {
              id: 'item-1',
              nombre: 'Helado',
              imagenKey: 'tenant-1/menu/helado.jpg',
            },
            { id: 'item-2', nombre: 'Flan', imagenKey: null },
          ],
        },
      ]);

      const result = await service.findAllCategorias(
        tenantId,
        restauranteId,
        keycloakId,
      );

      expect(mockStorage.getSignedImageUrl).toHaveBeenCalledTimes(1);
      expect(mockStorage.getSignedImageUrl).toHaveBeenCalledWith(
        'tenant-1/menu/helado.jpg',
      );
      expect(result[0].items[0].imagenUrl).toBe(URL_FIRMADA);
      expect(result[0].items[1].imagenUrl).toBeNull();
      // El resto de los campos del ítem se conserva.
      expect(result[0].items[0].imagenKey).toBe('tenant-1/menu/helado.jpg');
    });

    it('devuelve imagenUrl null si la firma falla (BL-257)', async () => {
      // getSignedImageUrl ya captura el error de S3 y devuelve null.
      mockStorage.getSignedImageUrl.mockResolvedValue(null);
      mockTx.categoriaCarta.findMany.mockResolvedValue([
        {
          id: 'cat-1',
          nombre: 'Postres',
          items: [
            {
              id: 'item-1',
              nombre: 'Helado',
              imagenKey: 'tenant-1/menu/helado.jpg',
            },
          ],
        },
      ]);

      const result = await service.findAllCategorias(
        tenantId,
        restauranteId,
        keycloakId,
      );

      expect(result[0].items[0].imagenUrl).toBeNull();
    });
  });

  describe('createCategoria', () => {
    const tenantId = 'test-tenant-id';
    const restauranteId = 'rest-123';
    const keycloakId = 'user-123';

    it('debe crear una categoría con orden personalizado', async () => {
      const body = { nombre: 'Bebidas', orden: 5 };
      const mockCategoria = {
        id: 'cat-new',
        ...body,
        restauranteId,
        tenantId,
      };

      mockTx.categoriaCarta.create.mockResolvedValue(mockCategoria);

      const result = await service.createCategoria(
        tenantId,
        restauranteId,
        keycloakId,
        body,
      );

      expect(result).toEqual(mockCategoria);
      expect(mockTx.categoriaCarta.create).toHaveBeenCalledWith({
        data: {
          nombre: 'Bebidas',
          orden: 5,
          restauranteId,
          tenantId,
        },
      });
    });

    it('debe crear una categoría con orden por defecto (0) si no se especifica', async () => {
      const body = { nombre: 'Postres' };
      const mockCategoria = {
        id: 'cat-new-2',
        nombre: 'Postres',
        orden: 0,
        restauranteId,
        tenantId,
      };

      mockTx.categoriaCarta.create.mockResolvedValue(mockCategoria);

      const result = await service.createCategoria(
        tenantId,
        restauranteId,
        keycloakId,
        body,
      );

      expect(result).toEqual(mockCategoria);
      expect(mockTx.categoriaCarta.create).toHaveBeenCalledWith({
        data: {
          nombre: 'Postres',
          orden: 0,
          restauranteId,
          tenantId,
        },
      });
    });
  });

  describe('updateCategoria', () => {
    const tenantId = 'test-tenant-id';
    const categoriaId = 'cat-123';

    it('debe emitir evento cuando se actualiza el campo activo', async () => {
      const dto: UpdateCategoriaDto = { activo: false };
      const mockExisting = {
        id: categoriaId,
        nombre: 'Pizzas',
        activo: true,
        tenantId,
      };
      const mockUpdated = { ...mockExisting, ...dto };

      mockTx.categoriaCarta.findFirst.mockResolvedValue(mockExisting);
      mockTx.categoriaCarta.update.mockResolvedValue(mockUpdated);

      await service.updateCategoria(tenantId, categoriaId, dto);

      expect(mockMenuGateway.emitCategoriaUpdated).toHaveBeenCalledWith(
        tenantId,
        {
          categoriaId,
          activo: false,
        },
      );
    });

    it('no debe emitir evento cuando activo no está en el dto', async () => {
      const dto: UpdateCategoriaDto = { nombre: 'Pizzas Italianas' };
      const mockExisting = {
        id: categoriaId,
        nombre: 'Pizzas',
        activo: true,
        tenantId,
      };
      const mockUpdated = { ...mockExisting, ...dto };

      mockTx.categoriaCarta.findFirst.mockResolvedValue(mockExisting);
      mockTx.categoriaCarta.update.mockResolvedValue(mockUpdated);

      await service.updateCategoria(tenantId, categoriaId, dto);

      expect(mockMenuGateway.emitCategoriaUpdated).not.toHaveBeenCalled();
    });
  });

  describe('deleteCategoria', () => {
    const tenantId = 'test-tenant-id';
    const categoriaId = 'cat-123';

    it('debe realizar un soft delete (activo: false) y emitir evento WebSocket', async () => {
      const mockExisting = {
        id: categoriaId,
        nombre: 'Pizzas',
        activo: true,
        tenantId,
      };
      const mockDeleted = { ...mockExisting, activo: false };

      mockTx.categoriaCarta.findFirst.mockResolvedValue(mockExisting);
      mockTx.categoriaCarta.update.mockResolvedValue(mockDeleted);

      const result = await service.deleteCategoria(tenantId, categoriaId);

      expect(result.activo).toBe(false);
      expect(mockTx.categoriaCarta.update).toHaveBeenCalledWith({
        where: { id: categoriaId },
        data: { activo: false },
      });
      expect(mockMenuGateway.emitCategoriaUpdated).toHaveBeenCalledWith(
        tenantId,
        { categoriaId, activo: false },
      );
    });

    it('debe lanzar NotFoundException si la categoría no existe', async () => {
      mockTx.categoriaCarta.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteCategoria(tenantId, categoriaId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.deleteCategoria(tenantId, categoriaId),
      ).rejects.toThrow('Categoría no encontrada o no pertenece a este tenant');
    });
  });
});
