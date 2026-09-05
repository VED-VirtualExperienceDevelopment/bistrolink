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
// SETUP: Configuración reutilizable de mocks
// ═══════════════════════════════════════════════════════════════════════════

describe('MenuService - getMenuByRestaurante (HU-002)', () => {
  let service: MenuService;
  let mockTx: any;
  let mockStorage: jest.Mocked<StorageService>;

  beforeEach(async () => {
    // Mock de la transacción de Prisma
    mockTx = {
      restaurante: {
        findUnique: jest.fn(),
      },
      categoriaCarta: {
        findMany: jest.fn(),
      },
    };

    // Mock de TenantPrismaService que ejecuta el callback con el tx mockeado
    const mockTenantPrisma = {
      runInTenantContext: jest.fn(async (_tenantId: string, callback: any) => {
        return callback(mockTx);
      }),
    };

    // Mock de StorageService
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

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Simular que Prisma aplica filtros de la query
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Configura el mock de categoriaCarta.findMany para que aplique el filtro
   * where.disponible si está presente en los parámetros (simulando Prisma).
   */
  function mockCategoriaCartaFindMany(categorias: any[]) {
    mockTx.categoriaCarta.findMany.mockImplementation(async (params: any) => {
      // Si hay filtro de items, aplicarlo
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

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS: Comportamiento observable (no implementación interna)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Casos de éxito', () => {
    it('debe devolver el menú completo con restaurante y categorías', async () => {
      // Arrange
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

      // Act
      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );

      // Assert: verificamos COMPORTAMIENTO, no implementación
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

    it('debe devolver solo items disponibles (items no disponibles se excluyen)', async () => {
      // Arrange
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });
      const itemDisponible = buildItem({
        nombre: 'Disponible',
        disponible: true,
      });
      const itemNoDisponible = buildItem({
        nombre: 'No disponible',
        disponible: false,
      });
      const categoria = buildCategoria({
        items: [itemDisponible, itemNoDisponible],
      });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([categoria]);

      // Act
      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );

      // Assert: COMPORTAMIENTO - solo items disponibles deben aparecer
      const itemsDevueltos = resultado.categorias[0].items;
      expect(itemsDevueltos).toHaveLength(1);
      expect(itemsDevueltos[0].nombre).toBe('Disponible');
      expect(
        itemsDevueltos.find((i) => i.nombre === 'No disponible'),
      ).toBeUndefined();
    });

    it('debe manejar múltiples categorías ordenadas correctamente', async () => {
      // Arrange
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });
      const cat1 = buildCategoria({ nombre: 'Entradas', orden: 1 });
      const cat2 = buildCategoria({ nombre: 'Platos principales', orden: 2 });
      const cat3 = buildCategoria({ nombre: 'Postres', orden: 3 });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([cat1, cat2, cat3]);

      // Act
      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );

      // Assert: COMPORTAMIENTO - las categorías deben estar en el orden correcto
      expect(resultado.categorias).toHaveLength(3);
      expect(resultado.categorias[0].nombre).toBe('Entradas');
      expect(resultado.categorias[1].nombre).toBe('Platos principales');
      expect(resultado.categorias[2].nombre).toBe('Postres');
    });

    it('debe generar URLs firmadas solo para items con imagenKey', async () => {
      // Arrange
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });
      const itemConImagen = buildItem({
        nombre: 'Con imagen',
        imagenKey: 'path/to/image.jpg',
      });
      const itemSinImagen = buildItem({
        nombre: 'Sin imagen',
        imagenKey: null,
      });
      const categoria = buildCategoria({
        items: [itemConImagen, itemSinImagen],
      });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([categoria]);
      mockStorage.getSignedImageUrl.mockResolvedValue(
        'https://s3.example.com/signed',
      );

      // Act
      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );

      // Assert: COMPORTAMIENTO - solo items con imagenKey deben tener URL firmada
      const items = resultado.categorias[0].items;
      const itemConImg = items.find((i) => i.nombre === 'Con imagen');
      const itemSinImg = items.find((i) => i.nombre === 'Sin imagen');

      expect(itemConImg?.imagenUrl).toBe('https://s3.example.com/signed');
      expect(itemSinImg?.imagenUrl).toBeNull();
      expect(mockStorage.getSignedImageUrl).toHaveBeenCalledTimes(1);
      expect(mockStorage.getSignedImageUrl).toHaveBeenCalledWith(
        'path/to/image.jpg',
      );
    });

    it('debe devolver menú vacío cuando el restaurante no tiene categorías', async () => {
      // Arrange
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([]);

      // Act
      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );

      // Assert: COMPORTAMIENTO - debe devolver estructura válida pero vacía
      expect(resultado.restaurante.id).toBe(restaurante.id);
      expect(resultado.categorias).toEqual([]);
    });
  });

  describe('Casos de error', () => {
    it('debe lanzar NotFoundException si el restaurante no existe', async () => {
      // Arrange
      const tenantId = randomUUID();
      const restauranteIdInexistente = randomUUID();

      mockTx.restaurante.findUnique.mockResolvedValue(null);

      // Act & Assert: COMPORTAMIENTO - debe fallar con NotFoundException
      await expect(
        service.getMenuByRestaurante(tenantId, restauranteIdInexistente),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Propiedades invariantes (siempre deben cumplirse)', () => {
    it('siempre debe incluir el ID del restaurante en la respuesta', async () => {
      // Arrange
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([]);

      // Act
      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );

      // Assert: PROPIEDAD - el ID del restaurante SIEMPRE debe estar presente
      expect(resultado.restaurante.id).toBe(restaurante.id);
    });

    it('nunca debe devolver items con disponible=false', async () => {
      // Arrange
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });
      const categoria = buildCategoria({
        items: [
          buildItem({ disponible: true }),
          buildItem({ disponible: false }),
          buildItem({ disponible: true }),
          buildItem({ disponible: false }),
        ],
      });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([categoria]);

      // Act
      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );

      // Assert: PROPIEDAD INVARIANTE - NINGÚN item debe tener disponible=false
      const todosLosItems = resultado.categorias.flatMap((cat) => cat.items);
      const itemsNoDisponibles = todosLosItems.filter(
        (item) => !item.disponible,
      );
      expect(itemsNoDisponibles).toHaveLength(0);
    });

    it('debe preservar los precios como Decimal (sin conversión a number)', async () => {
      // Arrange
      const tenantId = randomUUID();
      const restaurante = buildRestaurante({ tenantId });
      const item = buildItem({ precio: new Decimal('1234.56') });
      const categoria = buildCategoria({ items: [item] });

      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);
      mockCategoriaCartaFindMany([categoria]);

      // Act
      const resultado = await service.getMenuByRestaurante(
        tenantId,
        restaurante.id,
      );

      // Assert: PROPIEDAD - el precio debe mantenerse como Decimal
      const itemDevuelto = resultado.categorias[0].items[0];
      expect(itemDevuelto.precio).toBeInstanceOf(Decimal);
      expect(itemDevuelto.precio.toString()).toBe('1234.56');
    });
  });
});
