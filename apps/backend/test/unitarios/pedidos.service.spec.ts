import { Decimal } from '@prisma/client/runtime/library';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  PedidosService,
  ESTADO_INICIAL_PEDIDO,
} from '../../src/pedidos/pedidos.service';
import { hashTokenAcceso } from '../../src/pedidos/token-acceso-pedido';
import { CrearPedidoDto } from '../../src/pedidos/dto/crear-pedido.dto';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_ID = '33333333-3333-3333-3333-333333333333';

/**
 * BL-204: mesa del QR, tal como la deja MesaQrGuard en request.mesaQr. El
 * pedido de mesa solo existe con QR: el body no acepta mesaId.
 */
const MESA_QR = {
  tenantId: TENANT_ID,
  mesaId: MESA_ID,
  restauranteId: RESTAURANTE_ID,
  numero: 7,
  sesionId: '99999999-9999-4999-8999-999999999999',
};

/** BL-309: mesa real tal como la devuelve tx.mesa.findUnique. */
function mesaReal(overrides: Record<string, unknown> = {}) {
  return {
    id: MESA_ID,
    tenantId: TENANT_ID,
    restauranteId: RESTAURANTE_ID,
    numero: 7,
    esVirtual: false,
    ...overrides,
  };
}

function dtoBase(overrides: Partial<CrearPedidoDto> = {}): CrearPedidoDto {
  return {
    restauranteId: '22222222-2222-2222-2222-222222222222',
    idempotencyKey: 'clave-fija-de-prueba',
    items: [
      { itemCartaId: '55555555-5555-5555-5555-555555555555', cantidad: 2 },
    ],
    ...overrides,
  } as CrearPedidoDto;
}

/**
 * BL-244: pedido tal como lo devuelve `tx.pedido.create({ include: { lineas } })`,
 * con los campos que el mapper del KDS necesita y los que NO debe reenviar.
 */
function pedidoPrisma(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pedido-x',
    tenantId: TENANT_ID,
    mesaId: '33333333-3333-3333-3333-333333333333',
    idempotencyKey: 'clave-fija-de-prueba',
    estado: 'RECIBIDO',
    canal: 'QR',
    createdAt: new Date('2026-10-10T23:41:00.000Z'),
    observacionGeneral: null,
    lineas: [
      {
        id: 'linea-1',
        nombreSnapshot: 'Milanesa a la napolitana',
        precioUnitarioSnapshot: new Decimal('590'),
        subtotal: new Decimal('590'),
        cantidad: 1,
        observacion: null,
      },
    ],
    ...overrides,
  };
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
      restaurante: { findUnique: jest.fn() },
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

    const resultado = await service.crear(TENANT_ID, dtoBase(), MESA_QR);

    expect(resultado).toEqual(pedidoExistente);
    expect(mockTx.pedido.create).not.toHaveBeenCalled();
  });

  it('NO vuelve a notificar al KDS si el pedido ya existía (evita duplicar la alerta en cocina)', async () => {
    mockTx.pedido.findUnique.mockResolvedValue({
      id: 'pedido-ya-creado',
      idempotencyKey: 'clave-fija-de-prueba',
      lineas: [],
    });

    await service.crear(TENANT_ID, dtoBase(), MESA_QR);

    expect(mockKdsGateway.emitirNuevoPedido).not.toHaveBeenCalled();
  });

  it('SÍ crea el pedido en PENDIENTE_PAGO cuando la idempotencyKey es nueva, y NO avisa al KDS (BL-311, prepago)', async () => {
    mockTx.pedido.findUnique.mockResolvedValue(null);
    mockTx.mesa.findUnique.mockResolvedValue(mesaReal({ numero: 5 }));
    mockTx.itemCarta.findMany.mockResolvedValue([
      {
        id: '55555555-5555-5555-5555-555555555555',
        nombre: 'Milanesa a la napolitana',
        precio: new Decimal('590'),
        disponible: true,
      },
    ]);
    const pedidoCreado = pedidoPrisma({ id: 'pedido-nuevo' });
    mockTx.pedido.create.mockResolvedValue(pedidoCreado);

    const resultado = await service.crear(TENANT_ID, dtoBase(), MESA_QR);

    expect(mockTx.pedido.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: 'PENDIENTE_PAGO' }),
      }),
    );
    // La respuesta al comensal sigue siendo el pedido completo (HU-003).
    expect(resultado).toEqual(pedidoCreado);
    // RD.03: cocina recién lo ve cuando se aprueba el pago (confirmarPagoEnTx).
    expect(mockKdsGateway.emitirNuevoPedido).not.toHaveBeenCalled();
  });

  it('dos llamadas seguidas con la MISMA key: la segunda no dispara un create', async () => {
    const pedidoCreado = pedidoPrisma({ id: 'pedido-nuevo' });

    mockTx.pedido.findUnique.mockResolvedValueOnce(null);
    mockTx.mesa.findUnique.mockResolvedValue(mesaReal({ numero: 5 }));
    mockTx.itemCarta.findMany.mockResolvedValue([
      {
        id: '55555555-5555-5555-5555-555555555555',
        nombre: 'Milanesa a la napolitana',
        precio: new Decimal('590'),
        disponible: true,
      },
    ]);
    mockTx.pedido.create.mockResolvedValue(pedidoCreado);

    const primeraLlamada = await service.crear(TENANT_ID, dtoBase(), MESA_QR);

    mockTx.pedido.findUnique.mockResolvedValueOnce(pedidoCreado);
    const segundaLlamada = await service.crear(TENANT_ID, dtoBase(), MESA_QR);

    expect(primeraLlamada.id).toBe(segundaLlamada.id);
    expect(mockTx.pedido.create).toHaveBeenCalledTimes(1);
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
      restaurante: { findUnique: jest.fn() },
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
    // BL-308: el restaurante del pedido para retirar es de este tenant.
    mockTx.restaurante.findUnique.mockResolvedValue({ tenantId: TENANT_ID });
  });

  it('rechaza con 404 si la mesa no existe', async () => {
    mockTx.mesa.findUnique.mockResolvedValue(null);

    await expect(service.crear(TENANT_ID, dtoBase(), MESA_QR)).rejects.toThrow(
      NotFoundException,
    );
    expect(mockTx.pedido.create).not.toHaveBeenCalled();
  });

  it('rechaza con 400 si algún ítem del pedido no existe en la carta', async () => {
    mockTx.mesa.findUnique.mockResolvedValue(mesaReal());
    mockTx.itemCarta.findMany.mockResolvedValue([]);

    await expect(service.crear(TENANT_ID, dtoBase(), MESA_QR)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockTx.pedido.create).not.toHaveBeenCalled();
  });

  it('[TC-U-215] BL-397: solo busca ítems no archivados de categorías visibles y no archivadas', async () => {
    mockTx.mesa.findUnique.mockResolvedValue(mesaReal());
    // Un ítem archivado o de una categoría oculta no vuelve de la consulta:
    // el pedido se rechaza como si el ítem no existiera.
    mockTx.itemCarta.findMany.mockResolvedValue([]);

    await expect(service.crear(TENANT_ID, dtoBase(), MESA_QR)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockTx.itemCarta.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['55555555-5555-5555-5555-555555555555'] },
        archivadoEn: null,
        categoria: { activo: true, archivadaEn: null },
      },
    });
    expect(mockTx.pedido.create).not.toHaveBeenCalled();
  });

  it('rechaza con 400 si el ítem existe pero no está disponible', async () => {
    mockTx.mesa.findUnique.mockResolvedValue(mesaReal());
    mockTx.itemCarta.findMany.mockResolvedValue([
      {
        id: '55555555-5555-5555-5555-555555555555',
        nombre: 'Milanesa a la napolitana',
        precio: new Decimal('590'),
        disponible: false,
      },
    ]);

    await expect(service.crear(TENANT_ID, dtoBase(), MESA_QR)).rejects.toThrow(
      '"Milanesa a la napolitana" no está disponible',
    );
    expect(mockTx.pedido.create).not.toHaveBeenCalled();
  });

  it('sin QR (flujo "desde fuera del local"), resuelve/crea la mesa virtual, no una real', async () => {
    const dtoSinMesa = dtoBase();
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
    mockTx.pedido.create.mockResolvedValue(
      pedidoPrisma({
        id: 'pedido-web',
        canal: 'WEB',
        mesaId: 'mesa-virtual-id',
      }),
    );

    await service.crear(TENANT_ID, dtoSinMesa);

    // BL-311 (prepago): tampoco el pedido para retirar va al KDS al crearse.
    expect(mockKdsGateway.emitirNuevoPedido).not.toHaveBeenCalled();

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

// BL-309: en el pedido de mesa, el restaurante sale de la mesa (servidor),
// no del body. El pedido para retirar sigue necesitando restauranteId.
describe('PedidosService.crear — mesa y restaurante (BL-309)', () => {
  let mockTx: any;
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let service: PedidosService;

  const ITEM_DISPONIBLE = {
    id: '55555555-5555-5555-5555-555555555555',
    nombre: 'Milanesa a la napolitana',
    precio: new Decimal('590'),
    disponible: true,
  };

  beforeEach(() => {
    mockTx = {
      pedido: { findUnique: jest.fn(), create: jest.fn() },
      mesa: { findUnique: jest.fn(), upsert: jest.fn() },
      restaurante: { findUnique: jest.fn() },
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
    // BL-308: el restaurante del pedido para retirar es de este tenant.
    mockTx.restaurante.findUnique.mockResolvedValue({ tenantId: TENANT_ID });
    mockTx.itemCarta.findMany.mockResolvedValue([ITEM_DISPONIBLE]);
    mockTx.pedido.create.mockResolvedValue(pedidoPrisma());
  });

  it('pedido de mesa sin restauranteId: lo toma de la mesa y crea el pedido', async () => {
    mockTx.mesa.findUnique.mockResolvedValue(mesaReal());

    await service.crear(
      TENANT_ID,
      dtoBase({ restauranteId: undefined }),
      MESA_QR,
    );

    expect(mockTx.pedido.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          restauranteId: RESTAURANTE_ID,
          mesaId: MESA_ID,
          canal: 'QR',
        }),
      }),
    );
    // BL-311 (prepago): no se avisa a cocina hasta que se apruebe el pago.
    expect(mockKdsGateway.emitirNuevoPedido).not.toHaveBeenCalled();
  });

  it('pedido de mesa con el restauranteId de la mesa: se acepta', async () => {
    mockTx.mesa.findUnique.mockResolvedValue(mesaReal());

    await service.crear(
      TENANT_ID,
      dtoBase({ restauranteId: RESTAURANTE_ID }),
      MESA_QR,
    );

    expect(mockTx.pedido.create).toHaveBeenCalled();
  });

  it('pedido de mesa con un restauranteId distinto al de la mesa: 403 y no se crea', async () => {
    mockTx.mesa.findUnique.mockResolvedValue(mesaReal());

    await expect(
      service.crear(
        TENANT_ID,
        dtoBase({ restauranteId: '99999999-9999-9999-9999-999999999999' }),
        MESA_QR,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(mockTx.pedido.create).not.toHaveBeenCalled();
    expect(mockKdsGateway.emitirNuevoPedido).not.toHaveBeenCalled();
  });

  it.each([
    ['es de otro tenant', { tenantId: 'aaaaaaaa-0000-0000-0000-000000000001' }],
    ['es la mesa virtual', { esVirtual: true, numero: 0 }],
  ])('404 si la mesa %s', async (_caso, overrides) => {
    mockTx.mesa.findUnique.mockResolvedValue(mesaReal(overrides));

    await expect(
      service.crear(TENANT_ID, dtoBase({ restauranteId: undefined }), MESA_QR),
    ).rejects.toThrow(NotFoundException);
    expect(mockTx.pedido.create).not.toHaveBeenCalled();
  });

  it('pedido para retirar sin restauranteId: 400 y no toca la mesa virtual', async () => {
    await expect(
      service.crear(TENANT_ID, dtoBase({ restauranteId: undefined })),
    ).rejects.toThrow(BadRequestException);
    expect(mockTx.mesa.upsert).not.toHaveBeenCalled();
    expect(mockTx.pedido.create).not.toHaveBeenCalled();
  });

  it('pedido para retirar: guarda el restauranteId del body y usa la mesa virtual', async () => {
    mockTx.mesa.upsert.mockResolvedValue({
      id: 'mesa-virtual-id',
      numero: 0,
      esVirtual: true,
    });

    await service.crear(TENANT_ID, dtoBase());

    expect(mockTx.pedido.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          restauranteId: RESTAURANTE_ID,
          mesaId: 'mesa-virtual-id',
          canal: 'WEB',
        }),
      }),
    );
  });
});

// BL-204: el pedido queda atado a la mesa del QR (MesaQrGuard) y, en el
// pedido para retirar, el restaurante tiene que ser del tenant (BL-308).
describe('PedidosService.crear — QR de mesa y restaurante del tenant (BL-204)', () => {
  let mockTx: any;
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let service: PedidosService;

  beforeEach(() => {
    mockTx = {
      pedido: { findUnique: jest.fn(), create: jest.fn() },
      mesa: { findUnique: jest.fn(), upsert: jest.fn() },
      restaurante: { findUnique: jest.fn() },
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
    mockTx.itemCarta.findMany.mockResolvedValue([
      {
        id: '55555555-5555-5555-5555-555555555555',
        nombre: 'Milanesa a la napolitana',
        precio: new Decimal('590'),
        disponible: true,
      },
    ]);
    mockTx.pedido.create.mockResolvedValue(pedidoPrisma());
  });

  it('con QR: usa la mesa del QR (el body no trae ids) y el canal es QR', async () => {
    mockTx.mesa.findUnique.mockResolvedValue(mesaReal());

    await service.crear(
      TENANT_ID,
      dtoBase({ restauranteId: undefined }),
      MESA_QR,
    );

    expect(mockTx.mesa.findUnique).toHaveBeenCalledWith({
      where: { id: MESA_ID },
    });
    expect(mockTx.pedido.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mesaId: MESA_ID,
          restauranteId: RESTAURANTE_ID,
          canal: 'QR',
        }),
      }),
    );
  });

  it('pedido para retirar: el canal es WEB, aunque no venga mesa', async () => {
    mockTx.restaurante.findUnique.mockResolvedValue({ tenantId: TENANT_ID });
    mockTx.mesa.upsert.mockResolvedValue({
      id: 'mesa-virtual-id',
      numero: 0,
      esVirtual: true,
    });

    await service.crear(TENANT_ID, dtoBase());

    expect(mockTx.restaurante.findUnique).toHaveBeenCalledWith({
      where: { id: RESTAURANTE_ID },
      select: { tenantId: true },
    });
    expect(mockTx.pedido.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ canal: 'WEB' }),
      }),
    );
  });

  describe('BL-311 (RD.05): token de acceso del pedido para retirar', () => {
    beforeEach(() => {
      mockTx.pedido.update = jest.fn();
      mockTx.restaurante.findUnique.mockResolvedValue({ tenantId: TENANT_ID });
      mockTx.mesa.upsert.mockResolvedValue({
        id: 'mesa-virtual-id',
        numero: 0,
        esVirtual: true,
      });
    });

    it('pedido para retirar: guarda solo el hash y devuelve el token en claro una vez', async () => {
      mockTx.pedido.create.mockImplementation(async ({ data }) =>
        pedidoPrisma({ canal: 'WEB', accesoTokenHash: data.accesoTokenHash }),
      );

      const resultado: any = await service.crear(TENANT_ID, dtoBase());

      const { accesoTokenHash } = mockTx.pedido.create.mock.calls[0][0].data;
      expect(resultado.tokenAcceso).toEqual(expect.any(String));
      expect(resultado.tokenAcceso.length).toBeGreaterThanOrEqual(43);
      expect(accesoTokenHash).toBe(hashTokenAcceso(resultado.tokenAcceso));
      // El hash nunca sale del backend.
      expect(resultado).not.toHaveProperty('accesoTokenHash');
    });

    it('pedido de mesa: no lleva token (se autoriza con el QR) ni guarda hash', async () => {
      mockTx.mesa.findUnique.mockResolvedValue(mesaReal());

      const resultado: any = await service.crear(
        TENANT_ID,
        dtoBase({ restauranteId: undefined }),
        MESA_QR,
      );

      expect(mockTx.pedido.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accesoTokenHash: null }),
        }),
      );
      expect(resultado).not.toHaveProperty('tokenAcceso');
    });

    it('dos pedidos para retirar no comparten token', async () => {
      mockTx.pedido.create.mockImplementation(async () =>
        pedidoPrisma({ canal: 'WEB' }),
      );

      const a: any = await service.crear(TENANT_ID, dtoBase());
      const b: any = await service.crear(TENANT_ID, dtoBase());

      expect(a.tokenAcceso).not.toBe(b.tokenAcceso);
    });

    it('reintento con la misma clave de un pedido para retirar: emite un token nuevo y reemplaza el hash', async () => {
      mockTx.pedido.findUnique.mockResolvedValue(
        pedidoPrisma({
          id: 'pedido-web',
          canal: 'WEB',
          accesoTokenHash: 'a'.repeat(64),
        }),
      );

      const resultado: any = await service.crear(TENANT_ID, dtoBase());

      expect(mockTx.pedido.create).not.toHaveBeenCalled();
      expect(mockTx.pedido.update).toHaveBeenCalledWith({
        where: { id: 'pedido-web' },
        data: { accesoTokenHash: hashTokenAcceso(resultado.tokenAcceso) },
      });
      expect(resultado).not.toHaveProperty('accesoTokenHash');
    });

    it('reintento con la misma clave de un pedido de mesa: no toca el token', async () => {
      mockTx.pedido.findUnique.mockResolvedValue(
        pedidoPrisma({ canal: 'QR', accesoTokenHash: null }),
      );

      const resultado: any = await service.crear(TENANT_ID, dtoBase(), MESA_QR);

      expect(mockTx.pedido.update).not.toHaveBeenCalled();
      expect(resultado).not.toHaveProperty('tokenAcceso');
    });
  });

  it.each([
    ['no existe o RLS no lo deja ver', null],
    ['es de otro tenant', { tenantId: 'aaaaaaaa-0000-0000-0000-000000000001' }],
  ])(
    'pedido para retirar con un restaurante que %s: 403 sin tocar la mesa virtual (BL-308)',
    async (_caso, restaurante) => {
      mockTx.restaurante.findUnique.mockResolvedValue(restaurante);

      await expect(service.crear(TENANT_ID, dtoBase())).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockTx.mesa.upsert).not.toHaveBeenCalled();
      expect(mockTx.pedido.create).not.toHaveBeenCalled();
    },
  );
});

describe('PedidosService.confirmarPagoEnTx / notificarPedidoConfirmado (BL-311, prepago RD.03)', () => {
  let mockTx: any;
  let mockKdsGateway: any;
  let service: PedidosService;

  // Lo que devuelve tx.pedido.findUniqueOrThrow con el select del servicio.
  const pedidoConfirmado = {
    id: 'pedido-nuevo',
    estado: 'RECIBIDO',
    createdAt: new Date('2026-10-10T23:41:00.000Z'),
    updatedAt: new Date('2026-10-10T23:45:00.000Z'),
    observacionGeneral: null,
    mesa: { numero: 5 },
    lineas: [
      {
        id: 'linea-1',
        nombreSnapshot: 'Milanesa a la napolitana',
        cantidad: 1,
        observacion: null,
      },
    ],
  };

  beforeEach(() => {
    mockTx = {
      pedido: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(pedidoConfirmado),
      },
      pedidoEstadoHistorial: { create: jest.fn() },
    };
    mockKdsGateway = {
      emitirNuevoPedido: jest.fn(),
      emitirActualizacionPedido: jest.fn(),
      emitirEstadoMesa: jest.fn(),
    };
    service = new PedidosService({} as any, mockKdsGateway);
  });

  it('pasa el pedido de PENDIENTE_PAGO a RECIBIDO solo si sigue en PENDIENTE_PAGO', async () => {
    await service.confirmarPagoEnTx(mockTx, TENANT_ID, 'pedido-nuevo');

    expect(mockTx.pedido.updateMany).toHaveBeenCalledWith({
      where: { id: 'pedido-nuevo', estado: 'PENDIENTE_PAGO' },
      data: { estado: 'RECIBIDO' },
    });
  });

  it('deja el cambio en el historial, sin usuario (lo dispara el pago, no el staff)', async () => {
    await service.confirmarPagoEnTx(mockTx, TENANT_ID, 'pedido-nuevo');

    expect(mockTx.pedidoEstadoHistorial.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT_ID,
        pedidoId: 'pedido-nuevo',
        usuarioId: null,
        estadoAnterior: 'PENDIENTE_PAGO',
        estadoNuevo: 'RECIBIDO',
      },
    });
  });

  it('HU-031 (BL-201): en efectivo, el historial guarda quién cobró', async () => {
    await service.confirmarPagoEnTx(
      mockTx,
      TENANT_ID,
      'pedido-nuevo',
      'usuario-mozo',
    );

    expect(mockTx.pedidoEstadoHistorial.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ usuarioId: 'usuario-mozo' }),
    });
  });

  it('devuelve el pedido con lo que necesita el KDS (mesa y líneas)', async () => {
    const resultado = await service.confirmarPagoEnTx(
      mockTx,
      TENANT_ID,
      'pedido-nuevo',
    );

    expect(resultado).toBe(pedidoConfirmado);
  });

  it('idempotente: si ya no estaba en PENDIENTE_PAGO, no toca el historial y devuelve null', async () => {
    mockTx.pedido.updateMany.mockResolvedValue({ count: 0 });

    const resultado = await service.confirmarPagoEnTx(
      mockTx,
      TENANT_ID,
      'pedido-nuevo',
    );

    expect(resultado).toBeNull();
    expect(mockTx.pedidoEstadoHistorial.create).not.toHaveBeenCalled();
    expect(mockTx.pedido.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('notificarPedidoConfirmado: al KDS va con la forma del snapshot, con mesaNumero (BL-244)', () => {
    service.notificarPedidoConfirmado(TENANT_ID, pedidoConfirmado as any);

    expect(mockKdsGateway.emitirNuevoPedido).toHaveBeenCalledWith(TENANT_ID, {
      id: 'pedido-nuevo',
      mesaNumero: 5,
      estado: 'RECIBIDO',
      createdAt: '2026-10-10T23:41:00.000Z',
      observacionGeneral: null,
      lineas: [
        {
          id: 'linea-1',
          nombreSnapshot: 'Milanesa a la napolitana',
          cantidad: 1,
          observacion: null,
        },
      ],
    });
  });

  it('notificarPedidoConfirmado: el evento al KDS no incluye datos que el tablero no usa (BL-244)', () => {
    service.notificarPedidoConfirmado(TENANT_ID, pedidoConfirmado as any);

    const [, emitido] = mockKdsGateway.emitirNuevoPedido.mock.calls[0];
    expect(emitido).not.toHaveProperty('updatedAt');
    expect(emitido).not.toHaveProperty('mesa');
  });

  it('notificarPedidoConfirmado: el pedido para retirar llega al KDS como «Mesa 0» (BL-244)', () => {
    service.notificarPedidoConfirmado(TENANT_ID, {
      ...pedidoConfirmado,
      mesa: { numero: 0 },
    } as any);

    expect(mockKdsGateway.emitirNuevoPedido).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ mesaNumero: 0 }),
    );
  });

  it('notificarPedidoConfirmado: avisa al comensal que sigue el pedido que pasó a RECIBIDO', () => {
    service.notificarPedidoConfirmado(TENANT_ID, pedidoConfirmado as any);

    expect(mockKdsGateway.emitirActualizacionPedido).toHaveBeenCalledWith(
      'pedido-nuevo',
      {
        id: 'pedido-nuevo',
        estado: 'RECIBIDO',
        actualizadoEn: '2026-10-10T23:45:00.000Z',
      },
    );
  });

  it('HU-017 (BL-60) notificarEstadoMesa: avisa al mapa de mesas el nuevo estado de la mesa', () => {
    service.notificarEstadoMesa(TENANT_ID, 'mesa-1', 'EN_PROCESO_DE_PAGO');

    expect(mockKdsGateway.emitirEstadoMesa).toHaveBeenCalledWith(
      TENANT_ID,
      'mesa-1',
      'EN_PROCESO_DE_PAGO',
    );
  });

  it('HU-031b (BL-442) notificarSolicitudEfectivo: avisa al staff con el mismo llamado, con el pago', () => {
    mockKdsGateway.emitirLlamado = jest.fn();
    const pago = { pedidoId: 'pedido-1', total: '810.00', pagaCon: null };

    service.notificarSolicitudEfectivo(
      TENANT_ID,
      { id: 'mesa-1', numero: 3 },
      pago,
    );

    expect(mockKdsGateway.emitirLlamado).toHaveBeenCalledWith(
      TENANT_ID,
      'mesa-1',
      3,
      pago,
    );
  });
});
