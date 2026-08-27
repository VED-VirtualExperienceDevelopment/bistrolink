import { Decimal } from '@prisma/client/runtime/library';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  PedidosService,
  ESTADO_INICIAL_PEDIDO,
} from '../../src/pedidos/pedidos.service';
import { CrearPedidoDto } from '../../src/pedidos/dto/crear-pedido.dto';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function dtoBase(overrides: Partial<CrearPedidoDto> = {}): CrearPedidoDto {
  return {
    restauranteId: '22222222-2222-2222-2222-222222222222',
    mesaId: '33333333-3333-3333-3333-333333333333',
    idempotencyKey: 'clave-fija-de-prueba',
    items: [
      { itemCartaId: '55555555-5555-5555-5555-555555555555', cantidad: 2 },
    ],
    ...overrides,
  } as CrearPedidoDto;
}

describe('PedidosService.crear - idempotencia', () => {
  let mockTx: any;
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let service: PedidosService;

  beforeEach(() => {
    mockTx = {
      pedido: { findUnique: jest.fn(), create: jest.fn() },
      mesa: { findUnique: jest.fn(), upsert: jest.fn() },
      itemCarta: { findMany: jest.fn() },
    };
    mockTenantPrisma = {
      runInTenantContext: jest.fn(
        (_tenantId: string, fn: (tx: unknown) => unknown) => fn(mockTx),
      ),
    };
    mockKdsGateway = { emitirNuevoPedido: jest.fn() };

    service = new PedidosService(mockTenantPrisma, mockKdsGateway);
  });

  it('NO crea un pedido nuevo si la idempotencyKey ya existe, devuelve el existente', async () => {
    const pedidoExistente = {
      id: 'pedido-ya-creado',
      idempotencyKey: 'clave-fija-de-prueba',
      estado: ESTADO_INICIAL_PEDIDO,
      lineas: [],
    };
    mockTx.pedido.findUnique.mockResolvedValue(pedidoExistente);

    const resultado = await service.crear(TENANT_ID, dtoBase());

    expect(resultado).toBe(pedidoExistente);
    expect(mockTx.pedido.create).not.toHaveBeenCalled();
  });

  it('NO vuelve a notificar al KDS si el pedido ya existía (evita duplicar la alerta en cocina)', async () => {
    mockTx.pedido.findUnique.mockResolvedValue({
      id: 'pedido-ya-creado',
      idempotencyKey: 'clave-fija-de-prueba',
      lineas: [],
    });

    await service.crear(TENANT_ID, dtoBase());

    expect(mockKdsGateway.emitirNuevoPedido).not.toHaveBeenCalled();
  });

  it('SÍ crea el pedido y notifica al KDS cuando la idempotencyKey es nueva', async () => {
    mockTx.pedido.findUnique.mockResolvedValue(null);
    mockTx.mesa.findUnique.mockResolvedValue({
      id: '33333333-3333-3333-3333-333333333333',
    });
    mockTx.itemCarta.findMany.mockResolvedValue([
      {
        id: '55555555-5555-5555-5555-555555555555',
        nombre: 'Milanesa a la napolitana',
        precio: new Decimal('590'),
        disponible: true,
      },
    ]);
    const pedidoCreado = { id: 'pedido-nuevo', lineas: [] };
    mockTx.pedido.create.mockResolvedValue(pedidoCreado);

    const resultado = await service.crear(TENANT_ID, dtoBase());

    expect(mockTx.pedido.create).toHaveBeenCalledTimes(1);
    expect(resultado).toBe(pedidoCreado);
    expect(mockKdsGateway.emitirNuevoPedido).toHaveBeenCalledWith(
      TENANT_ID,
      pedidoCreado,
    );
  });

  it('dos llamadas seguidas con la MISMA key: la segunda no dispara un create ni un aviso nuevo', async () => {
    const pedidoCreado = {
      id: 'pedido-nuevo',
      idempotencyKey: 'clave-fija-de-prueba',
      lineas: [],
    };

    mockTx.pedido.findUnique.mockResolvedValueOnce(null);
    mockTx.mesa.findUnique.mockResolvedValue({
      id: '33333333-3333-3333-3333-333333333333',
    });
    mockTx.itemCarta.findMany.mockResolvedValue([
      {
        id: '55555555-5555-5555-5555-555555555555',
        nombre: 'Milanesa a la napolitana',
        precio: new Decimal('590'),
        disponible: true,
      },
    ]);
    mockTx.pedido.create.mockResolvedValue(pedidoCreado);

    const primeraLlamada = await service.crear(TENANT_ID, dtoBase());

    mockTx.pedido.findUnique.mockResolvedValueOnce(pedidoCreado);
    const segundaLlamada = await service.crear(TENANT_ID, dtoBase());

    expect(primeraLlamada.id).toBe(segundaLlamada.id);
    expect(mockTx.pedido.create).toHaveBeenCalledTimes(1);
    expect(mockKdsGateway.emitirNuevoPedido).toHaveBeenCalledTimes(1);
  });
});
describe('PedidosService.crear — validaciones y mesa virtual', () => {
  let mockTx: any;
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let service: PedidosService;

  beforeEach(() => {
    mockTx = {
      pedido: { findUnique: jest.fn(), create: jest.fn() },
      mesa: { findUnique: jest.fn(), upsert: jest.fn() },
      itemCarta: { findMany: jest.fn() },
    };
    mockTenantPrisma = {
      runInTenantContext: jest.fn(
        (_tenantId: string, fn: (tx: unknown) => unknown) => fn(mockTx),
      ),
    };
    mockKdsGateway = { emitirNuevoPedido: jest.fn() };
    service = new PedidosService(mockTenantPrisma, mockKdsGateway);

    mockTx.pedido.findUnique.mockResolvedValue(null);
  });

  it('rechaza con 404 si la mesa no existe', async () => {
    mockTx.mesa.findUnique.mockResolvedValue(null);

    await expect(service.crear(TENANT_ID, dtoBase())).rejects.toThrow(
      NotFoundException,
    );
    expect(mockTx.pedido.create).not.toHaveBeenCalled();
  });

  it('rechaza con 400 si algún ítem del pedido no existe en la carta', async () => {
    mockTx.mesa.findUnique.mockResolvedValue({
      id: '33333333-3333-3333-3333-333333333333',
    });
    mockTx.itemCarta.findMany.mockResolvedValue([]);

    await expect(service.crear(TENANT_ID, dtoBase())).rejects.toThrow(
      BadRequestException,
    );
    expect(mockTx.pedido.create).not.toHaveBeenCalled();
  });

  it('rechaza con 400 si el ítem existe pero no está disponible', async () => {
    mockTx.mesa.findUnique.mockResolvedValue({
      id: '33333333-3333-3333-3333-333333333333',
    });
    mockTx.itemCarta.findMany.mockResolvedValue([
      {
        id: '55555555-5555-5555-5555-555555555555',
        nombre: 'Milanesa a la napolitana',
        precio: new Decimal('590'),
        disponible: false,
      },
    ]);

    await expect(service.crear(TENANT_ID, dtoBase())).rejects.toThrow(
      '"Milanesa a la napolitana" no está disponible',
    );
    expect(mockTx.pedido.create).not.toHaveBeenCalled();
  });

  it('sin mesaId (flujo "desde fuera del local"), resuelve/crea la mesa virtual, no una real', async () => {
    const dtoSinMesa = dtoBase({ mesaId: undefined });
    mockTx.mesa.upsert.mockResolvedValue({
      id: 'mesa-virtual-id',
      numero: 0,
      esVirtual: true,
    });
    mockTx.itemCarta.findMany.mockResolvedValue([
      {
        id: '55555555-5555-5555-5555-555555555555',
        nombre: 'Milanesa a la napolitana',
        precio: new Decimal('590'),
        disponible: true,
      },
    ]);
    mockTx.pedido.create.mockResolvedValue({
      id: 'pedido-web',
      canal: 'WEB',
      lineas: [],
    });

    await service.crear(TENANT_ID, dtoSinMesa);

    expect(mockTx.mesa.findUnique).not.toHaveBeenCalled();
    expect(mockTx.mesa.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          restauranteId_numero: {
            restauranteId: dtoSinMesa.restauranteId,
            numero: 0,
          },
        },
      }),
    );
    expect(mockTx.pedido.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          canal: 'WEB',
          mesaId: 'mesa-virtual-id',
        }),
      }),
    );
  });
});
