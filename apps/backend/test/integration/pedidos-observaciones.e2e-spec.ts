import { Decimal } from '@prisma/client/runtime/library';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PedidosService } from '../../src/pedidos/pedidos.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { KdsGateway } from '../../src/pedidos/kds.gateway';
import { CrearPedidoDto } from '../../src/pedidos/dto/crear-pedido.dto';

describe('Pedidos Observaciones - Integración (BL-41)', () => {
  let app: INestApplication;
  let pedidosService: PedidosService;
  let kdsGateway: KdsGateway;
  let mockTx: any;

  beforeAll(async () => {
    // Mock de la transacción de Prisma
    mockTx = {
      pedido: { findUnique: jest.fn(), create: jest.fn() },
      mesa: { findUnique: jest.fn(), upsert: jest.fn() },
      itemCarta: { findMany: jest.fn() },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        PedidosService,
        {
          provide: TenantPrismaService,
          useValue: {
            runInTenantContext: jest.fn((tenantId: string, fn: (tx: any) => any) => fn(mockTx)),
          },
        },
        {
          provide: KdsGateway,
          useValue: {
            emitirNuevoPedido: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    pedidosService = moduleFixture.get<PedidosService>(PedidosService);
    kdsGateway = moduleFixture.get<KdsGateway>(KdsGateway);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Setup común: el pedido no existe, la mesa existe, el ítem está disponible
    mockTx.pedido.findUnique.mockResolvedValue(null);
    mockTx.mesa.findUnique.mockResolvedValue({ id: '33333333-3333-3333-3333-333333333333' });
    mockTx.itemCarta.findMany.mockResolvedValue([
      {
        id: '55555555-5555-5555-5555-555555555555',
        nombre: 'Milanesa a la napolitana',
        precio: new Decimal('590'),
        disponible: true,
      },
    ]);
  });

  it('debe crear un pedido con observaciones de ítem y general, y enviar el payload correcto al KDS', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const dto: CrearPedidoDto = {
      restauranteId: '22222222-2222-2222-2222-222222222222',
      mesaId: '33333333-3333-3333-3333-333333333333',
      idempotencyKey: 'test-integration-obs-1',
      observacionGeneral: 'Sin gluten, por favor. Mesa 4.',
      items: [
        {
          itemCartaId: '55555555-5555-5555-5555-555555555555',
          cantidad: 1,
          observacion: 'Sin cebolla',
        },
      ],
    };

    const pedidoCreado = {
      id: 'pedido-nuevo-1',
      tenantId,
      observacionGeneral: dto.observacionGeneral,
      lineas: [
        {
          itemCartaId: '55555555-5555-5555-5555-555555555555',
          observacion: 'Sin cebolla',
        },
      ],
    };
    mockTx.pedido.create.mockResolvedValue(pedidoCreado);

    // Ejecutamos el servicio real
    await pedidosService.crear(tenantId, dto);

    // Verificamos que el gateway recibió el payload correcto
    expect(kdsGateway.emitirNuevoPedido).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        observacionGeneral: 'Sin gluten, por favor. Mesa 4.',
        lineas: expect.arrayContaining([
          expect.objectContaining({
            observacion: 'Sin cebolla',
          }),
        ]),
      }),
    );
  });

  it('debe crear un pedido sin observaciones sin romper el payload del KDS (campos undefined manejados)', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const dto: CrearPedidoDto = {
      restauranteId: '22222222-2222-2222-2222-222222222222',
      mesaId: '33333333-3333-3333-3333-333333333333',
      idempotencyKey: 'test-integration-obs-2',
      items: [
        {
          itemCartaId: '55555555-5555-5555-5555-555555555555',
          cantidad: 1,
        },
      ],
    };

    const pedidoCreado = {
      id: 'pedido-nuevo-2',
      tenantId,
      observacionGeneral: undefined,
      lineas: [
        {
          itemCartaId: '55555555-5555-5555-5555-555555555555',
          observacion: undefined,
        },
      ],
    };
    mockTx.pedido.create.mockResolvedValue(pedidoCreado);

    // Ejecutamos el servicio real
    await pedidosService.crear(tenantId, dto);

    // Verificamos que el gateway maneja correctamente los undefined sin romper
    expect(kdsGateway.emitirNuevoPedido).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        observacionGeneral: undefined,
        lineas: expect.arrayContaining([
          expect.objectContaining({
            observacion: undefined,
          }),
        ]),
      }),
    );
  });
});
