import { Decimal } from '@prisma/client/runtime/library';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PedidosService } from '../../src/pedidos/pedidos.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { KdsGateway } from '../../src/pedidos/kds.gateway';
import { CrearPedidoDto } from '../../src/pedidos/dto/crear-pedido.dto';

// BL-204: pedido desde la mesa del QR, tal como lo deja MesaQrGuard en
// request.mesaQr (el body ya no lleva mesaId).
const MESA_QR = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  mesaId: '33333333-3333-3333-3333-333333333333',
  restauranteId: '22222222-2222-2222-2222-222222222222',
  numero: 4,
};

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
            runInTenantContext: jest.fn(
              (tenantId: string, fn: (tx: any) => any) => fn(mockTx),
            ),
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
    // BL-309: el servicio valida que la mesa sea del tenant y no sea la
    // virtual, y toma el restaurante de la mesa (no del body).
    mockTx.mesa.findUnique.mockResolvedValue({
      id: '33333333-3333-3333-3333-333333333333',
      tenantId: '11111111-1111-1111-1111-111111111111',
      restauranteId: '22222222-2222-2222-2222-222222222222',
      numero: 4,
      esVirtual: false,
    });
    mockTx.itemCarta.findMany.mockResolvedValue([
      {
        id: '55555555-5555-5555-5555-555555555555',
        nombre: 'Milanesa a la napolitana',
        precio: new Decimal('590'),
        disponible: true,
      },
    ]);
  });

  it('[TC-I-022] Pedidos: crea un pedido con observaciones de ítem y general, envía payload correcto al KDS', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const dto: CrearPedidoDto = {
      restauranteId: '22222222-2222-2222-2222-222222222222',
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

    // BL-244: el pedido tal como lo devuelve Prisma, con los campos que el
    // mapper del KDS (aPedidoKds) necesita: estado, createdAt y, por línea,
    // id, nombreSnapshot y cantidad.
    const pedidoCreado = {
      id: 'pedido-nuevo-1',
      tenantId,
      estado: 'RECIBIDO',
      createdAt: new Date('2026-10-11T20:00:00.000Z'),
      observacionGeneral: dto.observacionGeneral,
      lineas: [
        {
          id: 'linea-1',
          itemCartaId: '55555555-5555-5555-5555-555555555555',
          nombreSnapshot: 'Milanesa a la napolitana',
          cantidad: 1,
          observacion: 'Sin cebolla',
        },
      ],
    };
    mockTx.pedido.create.mockResolvedValue(pedidoCreado);

    // Ejecutamos el servicio real
    await pedidosService.crear(tenantId, dto, MESA_QR);

    // Verificamos que el gateway recibió el payload correcto
    expect(kdsGateway.emitirNuevoPedido).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        mesaNumero: 4,
        observacionGeneral: 'Sin gluten, por favor. Mesa 4.',
        lineas: expect.arrayContaining([
          expect.objectContaining({
            observacion: 'Sin cebolla',
          }),
        ]),
      }),
    );
  });

  it('[TC-I-023] Pedidos: crea un pedido sin observaciones sin romper el payload del KDS (undefined manejados)', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const dto: CrearPedidoDto = {
      restauranteId: '22222222-2222-2222-2222-222222222222',
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
      estado: 'RECIBIDO',
      createdAt: new Date('2026-10-11T20:05:00.000Z'),
      observacionGeneral: undefined,
      lineas: [
        {
          id: 'linea-2',
          itemCartaId: '55555555-5555-5555-5555-555555555555',
          nombreSnapshot: 'Milanesa a la napolitana',
          cantidad: 1,
          observacion: undefined,
        },
      ],
    };
    mockTx.pedido.create.mockResolvedValue(pedidoCreado);

    // Ejecutamos el servicio real
    await pedidosService.crear(tenantId, dto, MESA_QR);

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
