import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';
import { MenuService } from '../../src/menu/menu.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { StorageService } from '../../src/menu/storage.service';

// ═══════════════════════════════════════════════════════════════════════════
// FACTORIES: Builders reutilizables para crear fixtures
// ═══════════════════════════════════════════════════════════════════════════

function buildRestaurante(overrides: Partial<any> = {}) {
  return {
    id: randomUUID(),
    tenantId: randomUUID(),
    nombre: 'Restaurante Test',
    direccion: 'Av. Test 1234',
    timezone: 'America/Montevideo',
    ...overrides,
  };
}

function buildCategoria(overrides: Partial<any> = {}) {
  return {
    id: randomUUID(),
    nombre: 'Categoría Test',
    orden: 1,
    activo: true,
    items: [],
    ...overrides,
  };
}

function buildItem(overrides: Partial<any> = {}) {
  return {
    id: randomUUID(),
    nombre: 'Item Test',
    descripcion: 'Descripción del item',
    precio: new Decimal('100.00'),
    disponible: true,
    imagenKey: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: getMenuByRestaurante (HU-002)
// ═══════════════════════════════════════════════════════════════════════════

describe('MenuService - getMenuByRestaurante (HU-002)', () => {
  let service: MenuService;
  let mockTx: any;
  let mockStorage: jest.Mocked<StorageService>;

  beforeEach(async () => {
    mockTx = {
      restaurante: {
        findUnique: jest.fn(),
      },
      categoriaCarta: {
        findMany: jest.fn(),
      },
    };

    const mockTenantPrisma = {
      runInTenantContext: jest.fn(async (_tenantId: string, callback: any) => {
        return callback(mockTx);
      }),
    };

    mockStorage = {
      getSignedImageUrl: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuService,
        { provide: TenantPrismaService, useValue: mockTenantPrisma },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get(MenuService);
  });

  function mockCategoriaCartaFindMany(categorias: any[]) {
    mockTx.categoriaCarta.findMany.mockImplementation(async (params: any) => {
      if (params?.include?.items?.where?.disponible !== undefined) {
        const filtroDisponible = params.include.items.where.disponible;
        return categorias.map((cat) => ({
          ...cat,
          items: cat.items.filter(
            (item: any) => item.disponible === filtroDisponible,
          ),
        }));
      }
      return categorias;
    });
  }

  describe('Casos de éxito', () => {
    it('debe devolver el menú completo con restaurante y categorías', async () => {
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });
      const item1 = buildItem({
        nombre: 'Milanesa',
        precio: new Decimal('590.00'),
      });
      const item2 = buildItem({
        nombre: 'Pizza',
        precio: new Decimal('450.00'),
      });
      const categoria = buildCategoria({
        nombre: 'Platos principales',
        items: [item1, item2],
      });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([categoria]);
      mockStorage.getSignedImageUrl.mockResolvedValue(
        'https://s3.example.com/imagen.jpg',
      );

      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );

      expect(resultado).toEqual({
        restaurante: expect.objectContaining({
          id: restaurante.id,
          nombre: restaurante.nombre,
          direccion: restaurante.direccion,
        }),
        categorias: [
          expect.objectContaining({
            id: categoria.id,
            nombre: categoria.nombre,
            items: expect.arrayContaining([
              expect.objectContaining({
                id: item1.id,
                nombre: item1.nombre,
                precio: item1.precio,
                disponible: true,
              }),
              expect.objectContaining({
                id: item2.id,
                nombre: item2.nombre,
                precio: item2.precio,
                disponible: true,
              }),
            ]),
          }),
        ],
      });
    });

    it('debe devolver solo items disponibles', async () => {
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });
      const categoria = buildCategoria({
        items: [
          buildItem({ nombre: 'Disponible', disponible: true }),
          buildItem({ nombre: 'No disponible', disponible: false }),
        ],
      });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([categoria]);

      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );

      const itemsDevueltos = resultado.categorias[0].items;
      expect(itemsDevueltos).toHaveLength(1);
      expect(itemsDevueltos[0].nombre).toBe('Disponible');
    });

    it('debe manejar múltiples categorías ordenadas correctamente', async () => {
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });
      const cat1 = buildCategoria({ nombre: 'Entradas', orden: 1 });
      const cat2 = buildCategoria({ nombre: 'Platos principales', orden: 2 });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([cat1, cat2]);

      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );

      expect(resultado.categorias).toHaveLength(2);
      expect(resultado.categorias[0].nombre).toBe('Entradas');
      expect(resultado.categorias[1].nombre).toBe('Platos principales');
    });

    it('debe generar URLs firmadas solo para items con imagenKey', async () => {
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });
      const categoria = buildCategoria({
        items: [
          buildItem({ nombre: 'Con imagen', imagenKey: 'path/to/image.jpg' }),
          buildItem({ nombre: 'Sin imagen', imagenKey: null }),
        ],
      });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([categoria]);
      mockStorage.getSignedImageUrl.mockResolvedValue(
        'https://s3.example.com/signed',
      );

      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );

      const items = resultado.categorias[0].items;
      expect(items.find((i: any) => i.nombre === 'Con imagen')?.imagenUrl).toBe(
        'https://s3.example.com/signed',
      );
      expect(
        items.find((i: any) => i.nombre === 'Sin imagen')?.imagenUrl,
      ).toBeNull();
      expect(mockStorage.getSignedImageUrl).toHaveBeenCalledTimes(1);
    });

    it('debe devolver menú vacío cuando el restaurante no tiene categorías', async () => {
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([]);

      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );

      expect(resultado.restaurante.id).toBe(restaurante.id);
      expect(resultado.categorias).toEqual([]);
    });
  });

  describe('Casos de error', () => {
    it('debe lanzar NotFoundException si el restaurante no existe', async () => {
      const tenantId = randomUUID();
      const restauranteIdInexistente = randomUUID();

      mockTx.restaurante.findUnique.mockResolvedValue(null);

      await expect(
        service.getMenuByRestaurante(tenantId, restauranteIdInexistente),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Propiedades invariantes', () => {
    it('siempre debe incluir el ID del restaurante en la respuesta', async () => {
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([]);

      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );
      expect(resultado.restaurante.id).toBe(restaurante.id);
    });

    it('nunca debe devolver items con disponible=false', async () => {
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });
      const categoria = buildCategoria({
        items: [
          buildItem({ disponible: true }),
          buildItem({ disponible: false }),
        ],
      });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([categoria]);

      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );
      const todosLosItems = resultado.categorias.flatMap(
        (cat: any) => cat.items,
      );
      const itemsNoDisponibles = todosLosItems.filter(
        (item: any) => !item.disponible,
      );

      expect(itemsNoDisponibles).toHaveLength(0);
    });

    it('debe preservar los precios como Decimal', async () => {
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });
      const categoria = buildCategoria({
        items: [buildItem({ precio: new Decimal('1234.56') })],
      });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([categoria]);

      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );
      const itemDevuelto = resultado.categorias[0].items[0];

      expect(itemDevuelto.precio).toBeInstanceOf(Decimal);
      expect(itemDevuelto.precio.toString()).toBe('1234.56');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TESTS: getMenuByMesa (HU-001) - Agregado para cubrir las líneas faltantes
// ═══════════════════════════════════════════════════════════════════════════

describe('MenuService - getMenuByMesa (HU-001)', () => {
  let service: MenuService;
  let mockTx: any;
  let mockStorage: jest.Mocked<StorageService>;

  beforeEach(async () => {
    mockTx = {
      mesa: {
        findUnique: jest.fn(),
      },
      categoriaCarta: {
        findMany: jest.fn(),
      },
    };

    const mockTenantPrisma = {
      runInTenantContext: jest.fn(async (_tenantId: string, callback: any) => {
        return callback(mockTx);
      }),
    };

    mockStorage = {
      getSignedImageUrl: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuService,
        { provide: TenantPrismaService, useValue: mockTenantPrisma },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get(MenuService);
  });

  describe('Casos de éxito', () => {
    it('debe devolver el menú de la mesa con restaurante y categorías', async () => {
      const tenantId = randomUUID();
      const mesaId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });
      const mesa = {
        id: mesaId,
        numero: 1,
        restauranteId: restaurante.id,
        restaurante: restaurante,
      };
      const item = buildItem({ nombre: 'Milanesa', disponible: true });
      const categoria = buildCategoria({
        nombre: 'Platos principales',
        activo: true,
        items: [item],
      });

      mockTx.mesa.findUnique.mockResolvedValue(mesa);
      mockTx.categoriaCarta.findMany.mockResolvedValue([categoria]);
      mockStorage.getSignedImageUrl.mockResolvedValue(
        'https://s3.example.com/imagen.jpg',
      );

      const resultado = await service.getMenuByMesa(tenantId, mesaId);

      expect(resultado).toEqual({
        restaurante: { nombre: restaurante.nombre },
        categorias: expect.arrayContaining([
          expect.objectContaining({
            id: categoria.id,
            nombre: categoria.nombre,
            items: expect.arrayContaining([
              expect.objectContaining({ id: item.id, nombre: item.nombre }),
            ]),
          }),
        ]),
      });
    });

    it('debe filtrar solo categorías activas e items disponibles', async () => {
      const tenantId = randomUUID();
      const mesaId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });
      const mesa = {
        id: mesaId,
        numero: 1,
        restauranteId: restaurante.id,
        restaurante: restaurante,
      };

      mockTx.mesa.findUnique.mockResolvedValue(mesa);
      mockTx.categoriaCarta.findMany.mockResolvedValue([]);

      await service.getMenuByMesa(tenantId, mesaId);

      expect(mockTx.categoriaCarta.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            restauranteId: restaurante.id,
            activo: true,
          },
          include: {
            items: {
              where: { disponible: true },
              orderBy: { nombre: 'asc' },
            },
          },
        }),
      );
    });
  });

  describe('Casos de error', () => {
    it('debe lanzar NotFoundException si la mesa no existe', async () => {
      const tenantId = randomUUID();
      const mesaIdInexistente = randomUUID();

      mockTx.mesa.findUnique.mockResolvedValue(null);

      await expect(
        service.getMenuByMesa(tenantId, mesaIdInexistente),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.getMenuByMesa(tenantId, mesaIdInexistente),
      ).rejects.toThrow('Mesa no encontrada para este establecimiento');
    });
  });
});
