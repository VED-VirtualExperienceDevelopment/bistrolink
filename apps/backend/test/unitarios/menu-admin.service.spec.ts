import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MENSAJE_CATEGORIA_ARCHIVADA,
  MENSAJE_CATEGORIA_CON_ITEMS,
  MENSAJE_CATEGORIA_CON_ITEMS_ACTIVOS,
  MENSAJE_CATEGORIA_REPETIDA,
  MENSAJE_EDICION_CONCURRENTE,
  MENSAJE_ITEM_ARCHIVADO,
  MENSAJE_ITEM_CON_HISTORIAL,
  MENSAJE_ITEM_REPETIDO,
  MenuAdminService,
} from '../../src/menu/menu-admin.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { MenuGateway } from '../../src/menu/menu.gateway';
import { StorageService } from '../../src/menu/storage.service';
import { AuditLogService } from '../../src/audit-log/audit-log.service';
import { CreateItemDto } from '../../src/menu/dto/create-item.dto';
import { UpdateItemDto } from '../../src/menu/dto/update-item.dto';
import { UpdateCategoriaDto } from '../../src/menu/dto/update-categoria.dto';

const URL_FIRMADA = 'https://bucket.example/img.jpg?X-Amz-Signature=abc';

// BL-54 y BL-387: keys de imagen propias y ajenas para los controles de
// tenant. Las publicadas son {tenant}/menu/{uuid}.webp.
const KEY_PROPIA =
  'test-tenant-id/menu/0b4f6a3e-1111-4c2d-9e8f-123456789abc.webp';
const KEY_AJENA = 'otro-tenant/menu/0b4f6a3e-2222-4c2d-9e8f-123456789abc.webp';
const MENSAJE_IMAGEN_AJENA =
  'La imagen indicada no pertenece a este restaurante';

// BL-395 y BL-394: errores de Prisma que la API traduce a 409.
const errorPrisma = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('Prisma error', {
    code,
    clientVersion: '0.0.0',
  });
// Índice único violado (nombre repetido).
const nombreRepetido = () => errorPrisma('P2002');
// update con WHERE que no encontró la fila (versión vieja).
const versionVieja = () => errorPrisma('P2025');
// FK violada (pedidos o ítems que apuntan a la fila).
const tieneReferencias = () => errorPrisma('P2003');

describe('MenuAdminService', () => {
  let service: MenuAdminService;

  const mockTx = {
    categoriaCarta: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    itemCarta: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      // BL-394: orden de los ítems nuevos, conteos y borrado definitivo.
      aggregate: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    lineaPedido: {
      count: jest.fn(),
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
    emitItemRetirado: jest.fn(),
    emitCategoriaRetirada: jest.fn(),
  };

  const mockStorage = {
    urlFirmadaDeLectura: jest.fn(),
    esKeyDelTenant: jest.fn(),
    existeImagen: jest.fn(),
  };

  const mockAuditLog = {
    registrar: jest.fn(),
    // HU-035 (BL-205): la carta se audita dentro de la transacción.
    registrarEnTx: jest.fn(),
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
        {
          provide: AuditLogService,
          useValue: mockAuditLog,
        },
      ],
    }).compile();

    service = module.get<MenuAdminService>(MenuAdminService);

    jest.clearAllMocks();
    // clearAllMocks no resetea implementaciones: se fija acá en cada test
    // para que un mockResolvedValue(null) de un test no se filtre al siguiente.
    mockStorage.urlFirmadaDeLectura.mockResolvedValue(URL_FIRMADA);
    // BL-54: la regla real de esKeyDelTenant se prueba en storage.service.spec.
    // Acá alcanza con simularla: solo son propias las keys bajo el prefijo.
    mockStorage.esKeyDelTenant.mockImplementation(
      (key: string, tenantId: string) => key.startsWith(`${tenantId}/menu/`),
    );
    // BL-387: por defecto la imagen existe en el bucket.
    mockStorage.existeImagen.mockResolvedValue(true);
    // BL-394: por defecto la categoría está vacía, el ítem no tiene pedidos y
    // un ítem nuevo va en la posición 1.
    mockTx.itemCarta.aggregate.mockResolvedValue({ _max: { orden: null } });
    mockTx.itemCarta.count.mockResolvedValue(0);
    mockTx.lineaPedido.count.mockResolvedValue(0);
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
          orden: 1,
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
          orden: 1,
          disponible: true,
        },
      });
    });

    describe('imagen del ítem (BL-54)', () => {
      const mockCategoria = { id: 'cat-123', nombre: 'Pizzas', tenantId };

      beforeEach(() => {
        mockTx.categoriaCarta.findFirst.mockResolvedValue(mockCategoria);
        mockTx.itemCarta.create.mockImplementation(({ data }) => ({
          id: 'item-123',
          ...data,
        }));
      });

      it('crea el ítem si la imagen es del propio tenant', async () => {
        const dto = { ...createItemDto, imagenKey: KEY_PROPIA };

        await service.createItem(tenantId, dto);

        expect(mockStorage.esKeyDelTenant).toHaveBeenCalledWith(
          KEY_PROPIA,
          tenantId,
        );
        expect(mockTx.itemCarta.create).toHaveBeenCalledWith({
          data: { ...dto, tenantId, disponible: true, orden: 1 },
        });
      });

      it('rechaza con BadRequestException una imagen de otro tenant', async () => {
        const dto = { ...createItemDto, imagenKey: KEY_AJENA };

        await expect(service.createItem(tenantId, dto)).rejects.toThrow(
          BadRequestException,
        );
        await expect(service.createItem(tenantId, dto)).rejects.toThrow(
          MENSAJE_IMAGEN_AJENA,
        );
        expect(mockTx.itemCarta.create).not.toHaveBeenCalled();
        expect(mockMenuGateway.emitItemDataUpdated).not.toHaveBeenCalled();
      });

      it('no valida la imagen si el ítem no trae imagenKey', async () => {
        await service.createItem(tenantId, createItemDto);

        expect(mockStorage.esKeyDelTenant).not.toHaveBeenCalled();
        expect(mockTx.itemCarta.create).toHaveBeenCalled();
      });

      // BL-391 (BL-387)
      it('rechaza una key bien formada que no existe en el bucket, sin abrir la transacción', async () => {
        mockStorage.existeImagen.mockResolvedValue(false);
        const dto = { ...createItemDto, imagenKey: KEY_PROPIA };

        await expect(service.createItem(tenantId, dto)).rejects.toThrow(
          'La imagen indicada no existe. Volvé a subirla.',
        );
        expect(mockPrismaService.runInTenantContext).not.toHaveBeenCalled();
        expect(mockAuditLog.registrarEnTx).not.toHaveBeenCalled();
      });

      it('audita el alta de un ítem con imagen, con el actor del token', async () => {
        const dto = { ...createItemDto, imagenKey: KEY_PROPIA };

        await service.createItem(tenantId, dto, 'sub-del-admin');

        expect(mockAuditLog.registrarEnTx).toHaveBeenCalledWith(mockTx, {
          action: 'CARTA_ITEM_IMAGEN_CAMBIADA',
          tenantId,
          actorKeycloakId: 'sub-del-admin',
          entidadId: 'item-123',
          detalle: {
            itemId: 'item-123',
            imagenKeyAnterior: null,
            imagenKeyNueva: KEY_PROPIA,
          },
        });
      });

      it('no audita el alta de un ítem sin imagen', async () => {
        await service.createItem(tenantId, createItemDto, 'sub-del-admin');

        expect(mockAuditLog.registrarEnTx).not.toHaveBeenCalled();
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

    describe('HU-035 (BL-205): auditoría de precio y disponibilidad', () => {
      const anterior = {
        id: itemId,
        nombre: 'Pizza',
        precio: '12.50',
        disponible: true,
        tenantId,
      };

      it('un cambio de precio queda con el valor antes y después', async () => {
        mockTx.itemCarta.findFirst.mockResolvedValue(anterior);
        mockTx.itemCarta.update.mockResolvedValue({
          ...anterior,
          precio: '14',
        });

        await service.updateItem(
          tenantId,
          itemId,
          { precio: '14' } as UpdateItemDto,
          'sub-del-admin',
        );

        expect(mockAuditLog.registrarEnTx).toHaveBeenCalledWith(mockTx, {
          action: 'CARTA_ITEM_MODIFICADO',
          tenantId,
          actorKeycloakId: 'sub-del-admin',
          entidadId: itemId,
          antes: { precio: '12.50' },
          despues: { precio: '14.00' },
          detalle: { nombre: 'Pizza' },
        });
      });

      it('marcar como agotado queda como cambio de disponibilidad', async () => {
        mockTx.itemCarta.findFirst.mockResolvedValue(anterior);
        mockTx.itemCarta.update.mockResolvedValue({
          ...anterior,
          disponible: false,
        });

        await service.updateItem(tenantId, itemId, {
          disponible: false,
        } as UpdateItemDto);

        expect(mockAuditLog.registrarEnTx).toHaveBeenCalledWith(
          mockTx,
          expect.objectContaining({
            actorKeycloakId: 'desconocido',
            antes: { disponible: true },
            despues: { disponible: false },
          }),
        );
      });

      it('sin cambio de precio ni disponibilidad (por ejemplo, solo el nombre) no audita', async () => {
        mockTx.itemCarta.findFirst.mockResolvedValue(anterior);
        mockTx.itemCarta.update.mockResolvedValue({
          ...anterior,
          nombre: 'Pizza grande',
          precio: '12.5',
        });

        await service.updateItem(tenantId, itemId, {
          nombre: 'Pizza grande',
        } as UpdateItemDto);

        expect(mockAuditLog.registrarEnTx).not.toHaveBeenCalled();
      });
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

    describe('imagen del ítem (BL-54)', () => {
      const mockExisting = {
        id: itemId,
        categoriaId: 'cat-123',
        nombre: 'Pizza',
        precio: '10.00',
        tenantId,
      };

      beforeEach(() => {
        mockTx.itemCarta.findFirst.mockResolvedValue(mockExisting);
        mockTx.itemCarta.update.mockImplementation(({ data }) => ({
          ...mockExisting,
          ...data,
        }));
      });

      it('actualiza el ítem si la imagen es del propio tenant', async () => {
        const dto: UpdateItemDto = { imagenKey: KEY_PROPIA };

        await service.updateItem(tenantId, itemId, dto);

        expect(mockStorage.esKeyDelTenant).toHaveBeenCalledWith(
          KEY_PROPIA,
          tenantId,
        );
        expect(mockTx.itemCarta.update).toHaveBeenCalledWith({
          where: { id: itemId },
          data: dto,
        });
      });

      it('rechaza con BadRequestException una imagen de otro tenant', async () => {
        const dto: UpdateItemDto = { imagenKey: KEY_AJENA };

        await expect(service.updateItem(tenantId, itemId, dto)).rejects.toThrow(
          BadRequestException,
        );
        await expect(service.updateItem(tenantId, itemId, dto)).rejects.toThrow(
          MENSAJE_IMAGEN_AJENA,
        );
        expect(mockTx.itemCarta.update).not.toHaveBeenCalled();
        expect(mockMenuGateway.emitItemDataUpdated).not.toHaveBeenCalled();
      });

      it('no valida la imagen si el dto no trae imagenKey', async () => {
        await service.updateItem(tenantId, itemId, updateItemDto);

        expect(mockStorage.esKeyDelTenant).not.toHaveBeenCalled();
      });

      // BL-391 (BL-387): las imágenes anteriores al reprocesamiento siguen
      // sirviendo mientras no se reemplacen.
      it('no valida ni audita si el formulario reenvía la misma imagen', async () => {
        const keyVieja = 'test-tenant-id/menu/abc-foto.jpg';
        mockTx.itemCarta.findFirst.mockResolvedValue({
          ...mockExisting,
          imagenKey: keyVieja,
        });

        await service.updateItem(
          tenantId,
          itemId,
          { nombre: 'Pizza grande', imagenKey: keyVieja },
          'sub-del-admin',
        );

        expect(mockStorage.esKeyDelTenant).not.toHaveBeenCalled();
        expect(mockStorage.existeImagen).not.toHaveBeenCalled();
        expect(mockAuditLog.registrarEnTx).not.toHaveBeenCalled();
        expect(mockTx.itemCarta.update).toHaveBeenCalled();
      });

      it('audita el cambio de imagen con la key anterior y la nueva', async () => {
        const keyVieja = 'test-tenant-id/menu/abc-foto.jpg';
        mockTx.itemCarta.findFirst.mockResolvedValue({
          ...mockExisting,
          imagenKey: keyVieja,
        });

        await service.updateItem(
          tenantId,
          itemId,
          { imagenKey: KEY_PROPIA },
          'sub-del-admin',
        );

        expect(mockAuditLog.registrarEnTx).toHaveBeenCalledWith(mockTx, {
          action: 'CARTA_ITEM_IMAGEN_CAMBIADA',
          tenantId,
          actorKeycloakId: 'sub-del-admin',
          entidadId: itemId,
          detalle: {
            itemId,
            imagenKeyAnterior: keyVieja,
            imagenKeyNueva: KEY_PROPIA,
          },
        });
      });

      it('rechaza una imagen nueva que no existe en el bucket', async () => {
        mockStorage.existeImagen.mockResolvedValue(false);

        await expect(
          service.updateItem(tenantId, itemId, { imagenKey: KEY_PROPIA }),
        ).rejects.toThrow('La imagen indicada no existe. Volvé a subirla.');
        expect(mockTx.itemCarta.update).not.toHaveBeenCalled();
      });
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
          items: [
            {
              id: 'item-1',
              nombre: 'Pizza 1',
              tieneHistorial: false,
              imagenUrl: null,
            },
          ],
        },
        {
          id: 'cat-2',
          nombre: 'Bebidas',
          items: [
            {
              id: 'item-2',
              nombre: 'Coca Cola',
              tieneHistorial: false,
              imagenUrl: null,
            },
          ],
        },
      ]);

      // BL-394: sin archivados y con el conteo de pedidos por ítem.
      expect(mockTx.categoriaCarta.findMany).toHaveBeenCalledWith({
        where: { restauranteId, archivadaEn: null },
        include: {
          items: {
            where: { archivadoEn: null },
            orderBy: { nombre: 'asc' },
            include: { _count: { select: { lineasPedido: true } } },
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

      expect(mockStorage.urlFirmadaDeLectura).toHaveBeenCalledTimes(1);
      expect(mockStorage.urlFirmadaDeLectura).toHaveBeenCalledWith(
        'tenant-1/menu/helado.jpg',
      );
      expect(result[0].items[0].imagenUrl).toBe(URL_FIRMADA);
      expect(result[0].items[1].imagenUrl).toBeNull();
      // El resto de los campos del ítem se conserva.
      expect(result[0].items[0].imagenKey).toBe('tenant-1/menu/helado.jpg');
    });

    it('devuelve imagenUrl null si la firma falla (BL-257)', async () => {
      // urlFirmadaDeLectura ya captura el error de S3 y devuelve null.
      mockStorage.urlFirmadaDeLectura.mockResolvedValue(null);
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
    it('resuelve el restaurante desde el usuario si no viene restauranteId', async () => {
      mockTx.usuario.findFirst.mockResolvedValue({
        restauranteId: 'rest-del-usuario',
      });
      mockTx.categoriaCarta.findMany.mockResolvedValue([]);

      await service.findAllCategorias(tenantId, undefined, keycloakId);

      expect(mockTx.usuario.findFirst).toHaveBeenCalledWith({
        where: { keycloakId },
        select: { restauranteId: true },
      });
      expect(mockTx.categoriaCarta.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { restauranteId: 'rest-del-usuario', archivadaEn: null },
        }),
      );
    });

    it('lanza UnauthorizedException si no puede resolver el restaurante', async () => {
      mockTx.usuario.findFirst.mockResolvedValue(null);

      await expect(
        service.findAllCategorias(tenantId, undefined, keycloakId),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockStorage.urlFirmadaDeLectura).not.toHaveBeenCalled();
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

  describe('cambiarDisponibilidad (BL-395)', () => {
    const tenantId = 'test-tenant-id';
    const itemId = 'item-123';
    const actor = 'mozo-keycloak-id';
    const existente = {
      id: itemId,
      nombre: 'Picada Completa',
      precio: new Prisma.Decimal('890'),
      disponible: true,
      tenantId,
    };

    it('[TC-U-185] marca el ítem como agotado y avisa a las otras pantallas', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(existente);
      mockTx.itemCarta.update.mockResolvedValue({
        ...existente,
        disponible: false,
      });

      const result = await service.cambiarDisponibilidad(
        tenantId,
        itemId,
        false,
        actor,
      );

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

    it('[TC-U-185] solo cambia la disponibilidad, aunque el ítem tenga otros datos', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(existente);
      mockTx.itemCarta.update.mockResolvedValue(existente);

      await service.cambiarDisponibilidad(tenantId, itemId, true, actor);

      expect(mockTx.itemCarta.update.mock.calls[0][0].data).toEqual({
        disponible: true,
      });
    });

    it('[TC-U-186] queda en la auditoría con el actor del token (HU-035)', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(existente);
      mockTx.itemCarta.update.mockResolvedValue({
        ...existente,
        disponible: false,
      });

      await service.cambiarDisponibilidad(tenantId, itemId, false, actor);

      expect(mockAuditLog.registrarEnTx).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          tenantId,
          actorKeycloakId: actor,
          entidadId: itemId,
          antes: { disponible: true },
          despues: { disponible: false },
        }),
      );
    });

    it('[TC-U-187] devuelve 404 si el ítem no existe o es de otro tenant', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(null);

      await expect(
        service.cambiarDisponibilidad(tenantId, itemId, false, actor),
      ).rejects.toThrow(NotFoundException);
      expect(mockTx.itemCarta.update).not.toHaveBeenCalled();
      expect(mockMenuGateway.emitItemUpdated).not.toHaveBeenCalled();
    });
  });

  describe('nombres repetidos (BL-393 y BL-395)', () => {
    const tenantId = 'test-tenant-id';

    it('[TC-U-188] crear una categoría con un nombre que ya existe devuelve 409', async () => {
      mockTx.categoriaCarta.create.mockRejectedValueOnce(nombreRepetido());

      const crear = service.createCategoria(tenantId, 'rest-123', 'user-123', {
        nombre: 'Picadas',
      });
      await expect(crear).rejects.toThrow(ConflictException);
      await expect(crear).rejects.toThrow(MENSAJE_CATEGORIA_REPETIDA);
    });

    it('[TC-U-188] renombrar una categoría a un nombre que ya existe devuelve 409', async () => {
      mockTx.categoriaCarta.findFirst.mockResolvedValue({
        id: 'cat-123',
        nombre: 'Tablas',
        tenantId,
      });
      mockTx.categoriaCarta.update.mockRejectedValueOnce(nombreRepetido());

      await expect(
        service.updateCategoria(tenantId, 'cat-123', { nombre: 'Picadas' }),
      ).rejects.toThrow(MENSAJE_CATEGORIA_REPETIDA);
    });

    it('[TC-U-189] crear un ítem con un nombre que ya existe en la categoría devuelve 409', async () => {
      mockTx.categoriaCarta.findFirst.mockResolvedValue({
        id: 'cat-123',
        tenantId,
      });
      mockTx.itemCarta.create.mockRejectedValueOnce(nombreRepetido());

      await expect(
        service.createItem(tenantId, {
          categoriaId: 'cat-123',
          nombre: 'Picada Completa',
          precio: '890',
        }),
      ).rejects.toThrow(MENSAJE_ITEM_REPETIDO);
    });

    it('[TC-U-189] renombrar un ítem a un nombre que ya existe devuelve 409', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue({
        id: 'item-123',
        nombre: 'Picada Chica',
        categoriaId: 'cat-123',
        imagenKey: null,
        tenantId,
      });
      mockTx.itemCarta.update.mockRejectedValueOnce(nombreRepetido());

      await expect(
        service.updateItem(tenantId, 'item-123', { nombre: 'Picada Completa' }),
      ).rejects.toThrow(ConflictException);
    });

    it('[TC-U-190] otro error de la base no se convierte en 409', async () => {
      mockTx.categoriaCarta.create.mockRejectedValueOnce(new Error('se cayó'));

      await expect(
        service.createCategoria(tenantId, 'rest-123', 'user-123', {
          nombre: 'Picadas',
        }),
      ).rejects.toThrow('se cayó');
    });
  });
  describe('findAllCategorias con archivados e historial (BL-394)', () => {
    it('[TC-U-191] marca tieneHistorial según los pedidos del ítem', async () => {
      mockTx.categoriaCarta.findMany.mockResolvedValue([
        {
          id: 'cat-1',
          nombre: 'Picadas',
          items: [
            { id: 'i-1', nombre: 'Completa', _count: { lineasPedido: 3 } },
            { id: 'i-2', nombre: 'Chica', _count: { lineasPedido: 0 } },
          ],
        },
      ]);

      const result = await service.findAllCategorias('t', 'rest-1', 'u');

      expect(result[0].items[0].tieneHistorial).toBe(true);
      expect(result[0].items[1].tieneHistorial).toBe(false);
      // El conteo interno no viaja al frontend.
      expect(result[0].items[0]).not.toHaveProperty('_count');
    });

    it('[TC-U-192] con incluirArchivados lista también los archivados', async () => {
      mockTx.categoriaCarta.findMany.mockResolvedValue([]);

      await service.findAllCategorias('t', 'rest-1', 'u', true);

      const args = mockTx.categoriaCarta.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ restauranteId: 'rest-1' });
      expect(args.include.items).not.toHaveProperty('where');
    });
  });

  describe('archivar, restaurar y eliminar ítems (BL-394)', () => {
    const tenantId = 'test-tenant-id';
    const itemId = 'item-123';
    const activo = {
      id: itemId,
      nombre: 'Picada Completa',
      categoriaId: 'cat-123',
      archivadoEn: null,
      tenantId,
    };
    const archivado = { ...activo, archivadoEn: new Date('2026-10-30') };

    it('[TC-U-193] archivar guarda la fecha y avisa a las pantallas', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(activo);
      mockTx.itemCarta.update.mockResolvedValue({
        ...activo,
        archivadoEn: new Date(),
      });

      await service.archivarItem(tenantId, itemId);

      expect(mockTx.itemCarta.update).toHaveBeenCalledWith({
        where: { id: itemId },
        data: { archivadoEn: expect.any(Date) },
      });
      // No toca la disponibilidad: archivar y agotar son cosas distintas.
      expect(mockTx.itemCarta.update.mock.calls[0][0].data).not.toHaveProperty(
        'disponible',
      );
      expect(mockMenuGateway.emitItemRetirado).toHaveBeenCalledWith(tenantId, {
        itemId,
      });
    });

    it('[TC-U-193] archivar un ítem ya archivado no hace nada', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(archivado);

      const result = await service.archivarItem(tenantId, itemId);

      expect(result).toBe(archivado);
      expect(mockTx.itemCarta.update).not.toHaveBeenCalled();
    });

    it('[TC-U-194] restaurar vuelve a dejar el ítem activo', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(archivado);
      mockTx.categoriaCarta.findFirst.mockResolvedValue({
        id: 'cat-123',
        archivadaEn: null,
      });
      mockTx.itemCarta.update.mockResolvedValue(activo);

      await service.restaurarItem(tenantId, itemId);

      expect(mockTx.itemCarta.update).toHaveBeenCalledWith({
        where: { id: itemId },
        data: { archivadoEn: null },
      });
      expect(mockMenuGateway.emitItemDataUpdated).toHaveBeenCalled();
    });

    it('[TC-U-194] no restaura un ítem de una categoría archivada', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(archivado);
      mockTx.categoriaCarta.findFirst.mockResolvedValue({
        id: 'cat-123',
        archivadaEn: new Date(),
      });

      await expect(service.restaurarItem(tenantId, itemId)).rejects.toThrow(
        MENSAJE_CATEGORIA_ARCHIVADA,
      );
      expect(mockTx.itemCarta.update).not.toHaveBeenCalled();
    });

    it('[TC-U-194] restaurar con el nombre ya usado por otro ítem activo devuelve 409', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(archivado);
      mockTx.categoriaCarta.findFirst.mockResolvedValue({
        id: 'cat-123',
        archivadaEn: null,
      });
      mockTx.itemCarta.update.mockRejectedValueOnce(nombreRepetido());

      await expect(service.restaurarItem(tenantId, itemId)).rejects.toThrow(
        MENSAJE_ITEM_REPETIDO,
      );
    });

    it('[TC-U-195] elimina definitivamente un ítem sin pedidos', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(activo);

      const result = await service.eliminarItem(tenantId, itemId);

      expect(result).toEqual({ id: itemId, eliminado: true });
      expect(mockTx.lineaPedido.count).toHaveBeenCalledWith({
        where: { itemCartaId: itemId },
      });
      expect(mockTx.itemCarta.delete).toHaveBeenCalledWith({
        where: { id: itemId },
      });
      expect(mockMenuGateway.emitItemRetirado).toHaveBeenCalledWith(tenantId, {
        itemId,
      });
    });

    it('[TC-U-196] no elimina un ítem con pedidos: 409 «archivalo»', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(activo);
      mockTx.lineaPedido.count.mockResolvedValue(2);

      const eliminar = service.eliminarItem(tenantId, itemId);
      await expect(eliminar).rejects.toThrow(ConflictException);
      await expect(eliminar).rejects.toThrow(MENSAJE_ITEM_CON_HISTORIAL);
      expect(mockTx.itemCarta.delete).not.toHaveBeenCalled();
    });

    it('[TC-U-196] si un pedido se cruza con el borrado, la FK da el mismo 409', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(activo);
      mockTx.itemCarta.delete.mockRejectedValueOnce(tieneReferencias());

      await expect(service.eliminarItem(tenantId, itemId)).rejects.toThrow(
        MENSAJE_ITEM_CON_HISTORIAL,
      );
    });

    it('[TC-U-197] archivar, restaurar o eliminar un ítem de otro tenant da 404', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(null);

      await expect(service.archivarItem(tenantId, itemId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.restaurarItem(tenantId, itemId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.eliminarItem(tenantId, itemId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('archivar, restaurar y eliminar categorías (BL-394)', () => {
    const tenantId = 'test-tenant-id';
    const categoriaId = 'cat-123';
    const activa = {
      id: categoriaId,
      nombre: 'Picadas',
      activo: true,
      archivadaEn: null,
      tenantId,
    };

    it('[TC-U-198] archiva una categoría sin ítems activos', async () => {
      mockTx.categoriaCarta.findFirst.mockResolvedValue(activa);
      mockTx.categoriaCarta.update.mockResolvedValue({
        ...activa,
        archivadaEn: new Date(),
      });

      await service.archivarCategoria(tenantId, categoriaId);

      expect(mockTx.itemCarta.count).toHaveBeenCalledWith({
        where: { categoriaId, archivadoEn: null },
      });
      expect(mockTx.categoriaCarta.update).toHaveBeenCalledWith({
        where: { id: categoriaId },
        data: { archivadaEn: expect.any(Date) },
      });
      expect(mockMenuGateway.emitCategoriaRetirada).toHaveBeenCalledWith(
        tenantId,
        { categoriaId },
      );
    });

    it('[TC-U-199] no archiva una categoría con ítems activos', async () => {
      mockTx.categoriaCarta.findFirst.mockResolvedValue(activa);
      mockTx.itemCarta.count.mockResolvedValue(3);

      await expect(
        service.archivarCategoria(tenantId, categoriaId),
      ).rejects.toThrow(MENSAJE_CATEGORIA_CON_ITEMS_ACTIVOS);
      expect(mockTx.categoriaCarta.update).not.toHaveBeenCalled();
    });

    it('[TC-U-200] restaura una categoría archivada', async () => {
      mockTx.categoriaCarta.findFirst.mockResolvedValue({
        ...activa,
        archivadaEn: new Date(),
      });
      mockTx.categoriaCarta.update.mockResolvedValue(activa);

      await service.restaurarCategoria(tenantId, categoriaId);

      expect(mockTx.categoriaCarta.update).toHaveBeenCalledWith({
        where: { id: categoriaId },
        data: { archivadaEn: null },
      });
      expect(mockMenuGateway.emitCategoriaUpdated).toHaveBeenCalledWith(
        tenantId,
        { categoriaId, activo: true },
      );
    });

    it('[TC-U-201] elimina definitivamente una categoría sin ítems', async () => {
      mockTx.categoriaCarta.findFirst.mockResolvedValue(activa);

      const result = await service.eliminarCategoria(tenantId, categoriaId);

      expect(result).toEqual({ id: categoriaId, eliminada: true });
      expect(mockTx.itemCarta.count).toHaveBeenCalledWith({
        where: { categoriaId },
      });
      expect(mockTx.categoriaCarta.delete).toHaveBeenCalledWith({
        where: { id: categoriaId },
      });
    });

    it('[TC-U-202] no elimina una categoría con ítems, aunque estén archivados', async () => {
      mockTx.categoriaCarta.findFirst.mockResolvedValue(activa);
      mockTx.itemCarta.count.mockResolvedValue(1);

      await expect(
        service.eliminarCategoria(tenantId, categoriaId),
      ).rejects.toThrow(MENSAJE_CATEGORIA_CON_ITEMS);
      expect(mockTx.categoriaCarta.delete).not.toHaveBeenCalled();
    });

    it('[TC-U-203] categoría inexistente o de otro tenant da 404', async () => {
      mockTx.categoriaCarta.findFirst.mockResolvedValue(null);

      await expect(
        service.eliminarCategoria(tenantId, categoriaId),
      ).rejects.toThrow('Categoría no encontrada o no pertenece a este tenant');
    });
  });

  describe('ítems y categorías archivados no se editan (BL-394)', () => {
    const tenantId = 'test-tenant-id';

    it('[TC-U-204] editar un ítem archivado devuelve 409', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue({
        id: 'item-123',
        archivadoEn: new Date(),
      });

      await expect(
        service.updateItem(tenantId, 'item-123', { precio: '900' }),
      ).rejects.toThrow(MENSAJE_ITEM_ARCHIVADO);
      expect(mockTx.itemCarta.update).not.toHaveBeenCalled();
    });

    it('[TC-U-204] cambiar la disponibilidad de un ítem archivado devuelve 409', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue({
        id: 'item-123',
        archivadoEn: new Date(),
      });

      await expect(
        service.cambiarDisponibilidad(tenantId, 'item-123', true),
      ).rejects.toThrow(MENSAJE_ITEM_ARCHIVADO);
    });

    it('[TC-U-204] editar una categoría archivada devuelve 409', async () => {
      mockTx.categoriaCarta.findFirst.mockResolvedValue({
        id: 'cat-123',
        archivadaEn: new Date(),
      });

      await expect(
        service.updateCategoria(tenantId, 'cat-123', { nombre: 'Tablas' }),
      ).rejects.toThrow(MENSAJE_CATEGORIA_ARCHIVADA);
    });

    it('[TC-U-205] no se crea un ítem en una categoría archivada', async () => {
      mockTx.categoriaCarta.findFirst.mockResolvedValue({
        id: 'cat-123',
        archivadaEn: new Date(),
      });

      await expect(
        service.createItem(tenantId, {
          categoriaId: 'cat-123',
          nombre: 'Tabla de quesos',
          precio: '700',
        }),
      ).rejects.toThrow(MENSAJE_CATEGORIA_ARCHIVADA);
      expect(mockTx.itemCarta.create).not.toHaveBeenCalled();
    });
  });

  describe('orden de los ítems (BL-394)', () => {
    const tenantId = 'test-tenant-id';

    it('[TC-U-206] un ítem nuevo va al final de su categoría', async () => {
      mockTx.categoriaCarta.findFirst.mockResolvedValue({
        id: 'cat-123',
        archivadaEn: null,
      });
      mockTx.itemCarta.aggregate.mockResolvedValue({ _max: { orden: 7 } });
      mockTx.itemCarta.create.mockResolvedValue({ id: 'nuevo' });

      await service.createItem(tenantId, {
        categoriaId: 'cat-123',
        nombre: 'Tabla de quesos',
        precio: '700',
      });

      expect(mockTx.itemCarta.aggregate).toHaveBeenCalledWith({
        where: { categoriaId: 'cat-123' },
        _max: { orden: true },
      });
      expect(mockTx.itemCarta.create.mock.calls[0][0].data.orden).toBe(8);
    });

    it('[TC-U-206] un ítem movido de categoría va al final de la nueva', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue({
        id: 'item-123',
        categoriaId: 'cat-1',
        archivadoEn: null,
        imagenKey: null,
      });
      mockTx.categoriaCarta.findFirst.mockResolvedValue({
        id: 'cat-2',
        archivadaEn: null,
      });
      mockTx.itemCarta.aggregate.mockResolvedValue({ _max: { orden: 4 } });
      mockTx.itemCarta.update.mockResolvedValue({ id: 'item-123' });

      await service.updateItem(tenantId, 'item-123', { categoriaId: 'cat-2' });

      expect(mockTx.itemCarta.update.mock.calls[0][0].data).toEqual({
        categoriaId: 'cat-2',
        orden: 5,
      });
    });
  });

  describe('ediciones simultáneas: bloqueo optimista (BL-394)', () => {
    const tenantId = 'test-tenant-id';
    const cargado = new Date('2026-10-31T15:00:00.000Z');
    const item = {
      id: 'item-123',
      nombre: 'Picada Completa',
      categoriaId: 'cat-1',
      archivadoEn: null,
      imagenKey: null,
      updatedAt: cargado,
    };

    it('[TC-U-207] con la misma versión guarda y la usa en el WHERE', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(item);
      mockTx.itemCarta.update.mockResolvedValue(item);

      await service.updateItem(tenantId, 'item-123', {
        precio: '950',
        updatedAt: cargado.toISOString(),
      });

      expect(mockTx.itemCarta.update).toHaveBeenCalledWith({
        where: { id: 'item-123', updatedAt: cargado },
        data: { precio: '950' },
      });
    });

    it('[TC-U-208] si otra persona guardó después, 409 sin escribir', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue({
        ...item,
        updatedAt: new Date('2026-10-31T15:05:00.000Z'),
      });

      const editar = service.updateItem(tenantId, 'item-123', {
        precio: '950',
        updatedAt: cargado.toISOString(),
      });
      await expect(editar).rejects.toThrow(ConflictException);
      await expect(editar).rejects.toThrow(MENSAJE_EDICION_CONCURRENTE);
      expect(mockTx.itemCarta.update).not.toHaveBeenCalled();
    });

    it('[TC-U-208] si la otra edición se cruza entre la lectura y la escritura, también 409', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(item);
      mockTx.itemCarta.update.mockRejectedValueOnce(versionVieja());

      await expect(
        service.updateItem(tenantId, 'item-123', {
          precio: '950',
          updatedAt: cargado.toISOString(),
        }),
      ).rejects.toThrow(MENSAJE_EDICION_CONCURRENTE);
    });

    it('[TC-U-209] la categoría también usa la versión', async () => {
      mockTx.categoriaCarta.findFirst.mockResolvedValue({
        id: 'cat-1',
        archivadaEn: null,
        updatedAt: new Date('2026-10-31T15:05:00.000Z'),
      });

      await expect(
        service.updateCategoria(tenantId, 'cat-1', {
          nombre: 'Tablas',
          updatedAt: cargado.toISOString(),
        }),
      ).rejects.toThrow(MENSAJE_EDICION_CONCURRENTE);
    });

    it('[TC-U-210] sin versión guarda como antes (la vista la manda desde BL-398)', async () => {
      mockTx.itemCarta.findFirst.mockResolvedValue(item);
      mockTx.itemCarta.update.mockResolvedValue(item);

      await service.updateItem(tenantId, 'item-123', { precio: '950' });

      expect(mockTx.itemCarta.update).toHaveBeenCalledWith({
        where: { id: 'item-123' },
        data: { precio: '950' },
      });
    });
  });
});
