import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MesaEstado, PedidoEstado, Prisma } from '@prisma/client';
import { MesasService } from '../../src/mesas/mesas.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID_AJENO = 'aaaaaaaa-0000-0000-0000-000000000001';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_ID = '33333333-3333-3333-3333-333333333333';

const LAYOUT_EJEMPLO = {
  x: 10,
  y: 20,
  forma: 'CIRCULO' as const,
  ancho: 80,
  alto: 80,
  rotacion: 0,
};

function crearErrorP2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '0.0.0',
  });
}

describe('MesasService.llamarMozo', () => {
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let service: MesasService;

  const MESA_DEL_QR = {
    tenantId: TENANT_ID,
    mesaId: MESA_ID,
    restauranteId: RESTAURANTE_ID,
    numero: 5,
    sesionId: '99999999-9999-4999-8999-999999999999',
  };

  beforeEach(() => {
    mockTenantPrisma = { runInTenantContext: jest.fn() };
    mockKdsGateway = { emitirLlamado: jest.fn() };
    service = new MesasService(mockTenantPrisma, mockKdsGateway);
  });

  // BL-204: la mesa sale solo del QR, ya validado por MesaQrGuard.
  it('emite el llamado con la mesa y el número del QR', () => {
    const resultado = service.llamarMozo(TENANT_ID, MESA_DEL_QR);

    expect(mockKdsGateway.emitirLlamado).toHaveBeenCalledWith(
      TENANT_ID,
      MESA_ID,
      5,
    );
    expect(resultado).toEqual({ ok: true });
  });

  it('no vuelve a consultar la base: el QR ya se resolvió en MesaQrGuard', () => {
    service.llamarMozo(TENANT_ID, MESA_DEL_QR);

    expect(mockTenantPrisma.runInTenantContext).not.toHaveBeenCalled();
  });
});

describe('MesasService.obtenerLayout', () => {
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let mockTx: any;
  let service: MesasService;

  beforeEach(() => {
    mockTx = { mesa: { findMany: jest.fn() } };
    mockTenantPrisma = {
      runInTenantContext: jest.fn((_tenantId: string, cb: any) => cb(mockTx)),
    };
    mockKdsGateway = { emitirLlamado: jest.fn(), emitirEstadoMesa: jest.fn() };
    service = new MesasService(mockTenantPrisma, mockKdsGateway);
  });

  it('devuelve las mesas del restaurante con su layout y estado, excluyendo la mesa virtual', async () => {
    const mesas = [
      {
        id: MESA_ID,
        numero: 1,
        estado: MesaEstado.LIBRE,
        layout: LAYOUT_EJEMPLO,
      },
    ];
    mockTx.mesa.findMany.mockResolvedValue(mesas);

    const resultado = await service.obtenerLayout(TENANT_ID, RESTAURANTE_ID);

    expect(mockTx.mesa.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          esVirtual: false,
        },
        orderBy: { numero: 'asc' },
      }),
    );
    expect(resultado).toEqual(mesas);
  });
});

describe('MesasService.guardarLayout', () => {
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let mockTx: any;
  let service: MesasService;

  beforeEach(() => {
    mockTx = {
      restaurante: {
        findUnique: jest.fn().mockResolvedValue({ tenantId: TENANT_ID }),
      },
      mesa: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    mockTenantPrisma = {
      runInTenantContext: jest.fn((_tenantId: string, cb: any) => cb(mockTx)),
    };
    mockKdsGateway = { emitirLlamado: jest.fn(), emitirEstadoMesa: jest.fn() };
    service = new MesasService(mockTenantPrisma, mockKdsGateway);
  });

  it('actualiza una mesa existente del mismo tenant y restaurante', async () => {
    mockTx.mesa.findUnique.mockResolvedValue({
      id: MESA_ID,
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
    });
    mockTx.mesa.update.mockResolvedValue({
      id: MESA_ID,
      numero: 1,
      estado: MesaEstado.LIBRE,
      layout: LAYOUT_EJEMPLO,
    });

    const resultado = await service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
      { id: MESA_ID, numero: 1, ...LAYOUT_EJEMPLO },
    ]);

    expect(mockTx.mesa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MESA_ID },
        data: { layout: LAYOUT_EJEMPLO },
      }),
    );
    expect(resultado).toEqual([
      {
        id: MESA_ID,
        numero: 1,
        estado: MesaEstado.LIBRE,
        layout: LAYOUT_EJEMPLO,
      },
    ]);
  });

  it('rechaza con 404 si la mesa con ese id pertenece a otro restaurante o tenant', async () => {
    mockTx.mesa.findUnique.mockResolvedValue({
      id: MESA_ID,
      tenantId: TENANT_ID_AJENO,
      restauranteId: RESTAURANTE_ID,
    });

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
        { id: MESA_ID, numero: 1, ...LAYOUT_EJEMPLO },
      ]),
    ).rejects.toThrow(NotFoundException);
    expect(mockTx.mesa.update).not.toHaveBeenCalled();
  });

  it('crea una mesa nueva (sin id) con estado LIBRE por defecto', async () => {
    mockTx.mesa.create.mockResolvedValue({
      id: 'nueva-mesa-id',
      numero: 9,
      estado: MesaEstado.LIBRE,
      layout: LAYOUT_EJEMPLO,
    });

    const resultado = await service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
      { numero: 9, ...LAYOUT_EJEMPLO },
    ]);

    expect(mockTx.mesa.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          numero: 9,
          estado: MesaEstado.LIBRE,
          layout: LAYOUT_EJEMPLO,
        }),
      }),
    );
    expect(resultado).toEqual([
      {
        id: 'nueva-mesa-id',
        numero: 9,
        estado: MesaEstado.LIBRE,
        layout: LAYOUT_EJEMPLO,
      },
    ]);
  });

  it('rechaza con 409 si ya existe una mesa con ese numero en el restaurante (P2002)', async () => {
    mockTx.mesa.create.mockRejectedValue(crearErrorP2002());

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
        { numero: 9, ...LAYOUT_EJEMPLO },
      ]),
    ).rejects.toThrow(ConflictException);
  });

  it('repropaga cualquier error que no sea P2002 sin envolverlo en ConflictException', async () => {
    const errorInesperado = new Error('la base de datos no responde');
    mockTx.mesa.create.mockRejectedValue(errorInesperado);

    await expect(
      service.guardarLayout(TENANT_ID, RESTAURANTE_ID, [
        { numero: 9, ...LAYOUT_EJEMPLO },
      ]),
    ).rejects.toThrow(errorInesperado);
  });
});

describe('MesasService.actualizarLayoutMesa', () => {
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let mockTx: any;
  let service: MesasService;

  beforeEach(() => {
    mockTx = {
      mesa: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    mockTenantPrisma = {
      runInTenantContext: jest.fn((_tenantId: string, cb: any) => cb(mockTx)),
    };
    mockKdsGateway = { emitirLlamado: jest.fn(), emitirEstadoMesa: jest.fn() };
    service = new MesasService(mockTenantPrisma, mockKdsGateway);
  });

  it('rechaza con 404 si la mesa no existe en este tenant', async () => {
    mockTx.mesa.findUnique.mockResolvedValue(null);

    await expect(
      service.actualizarLayoutMesa(TENANT_ID, MESA_ID, LAYOUT_EJEMPLO),
    ).rejects.toThrow(NotFoundException);
    expect(mockTx.mesa.update).not.toHaveBeenCalled();
  });

  it('actualiza solo el campo layout, sin tocar numero ni estado', async () => {
    mockTx.mesa.findUnique.mockResolvedValue({ id: MESA_ID });
    mockTx.mesa.update.mockResolvedValue({
      id: MESA_ID,
      numero: 3,
      estado: MesaEstado.OCUPADA,
      layout: LAYOUT_EJEMPLO,
    });

    const resultado = await service.actualizarLayoutMesa(
      TENANT_ID,
      MESA_ID,
      LAYOUT_EJEMPLO,
    );

    expect(mockTx.mesa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MESA_ID },
        data: { layout: LAYOUT_EJEMPLO },
      }),
    );
    expect(resultado.layout).toEqual(LAYOUT_EJEMPLO);
  });
});

describe('MesasService: sesión de mesa (HU-017, BL-60)', () => {
  const SESION = '99999999-9999-4999-8999-999999999999';
  const MOZO_KEYCLOAK_ID = '77777777-7777-4777-8777-777777777777';
  let mockTenantPrisma: any;
  let mockKdsGateway: any;
  let mockTx: any;
  let service: MesasService;

  function mesa(overrides: Record<string, unknown> = {}) {
    return {
      id: MESA_ID,
      estado: MesaEstado.OCUPADA,
      sesionId: SESION,
      esVirtual: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    mockTx = {
      mesa: {
        findUnique: jest.fn().mockResolvedValue(mesa()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(({ where }: any) =>
          Promise.resolve({
            id: where.id,
            numero: 4,
            estado: mockTx.__estadoFinal,
            layout: null,
          }),
        ),
      },
      pedido: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      usuario: { findUnique: jest.fn().mockResolvedValue({ id: 'usuario-1' }) },
      pedidoEstadoHistorial: { createMany: jest.fn() },
    };
    mockTenantPrisma = {
      runInTenantContext: jest.fn((_tenantId: string, cb: any) => cb(mockTx)),
    };
    mockKdsGateway = { emitirLlamado: jest.fn(), emitirEstadoMesa: jest.fn() };
    service = new MesasService(mockTenantPrisma, mockKdsGateway);
  });

  describe('abrirSesion', () => {
    beforeEach(() => {
      mockTx.mesa.findUnique.mockResolvedValue(
        mesa({ estado: MesaEstado.LIBRE, sesionId: null }),
      );
      mockTx.__estadoFinal = MesaEstado.OCUPADA;
    });

    it('LIBRE => OCUPADA con una sesión nueva, y lo avisa por WebSocket', async () => {
      const resultado = await service.abrirSesion(TENANT_ID, MESA_ID);

      const { where, data } = mockTx.mesa.updateMany.mock.calls[0][0];
      expect(where).toEqual({ id: MESA_ID, estado: MesaEstado.LIBRE });
      expect(data.estado).toBe(MesaEstado.OCUPADA);
      expect(data.sesionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(data.sesionAbiertaEn).toBeInstanceOf(Date);
      expect(mockKdsGateway.emitirEstadoMesa).toHaveBeenCalledWith(
        TENANT_ID,
        MESA_ID,
        MesaEstado.OCUPADA,
      );
      expect(resultado.estado).toBe(MesaEstado.OCUPADA);
    });

    it('cada apertura tiene un id de sesión distinto', async () => {
      await service.abrirSesion(TENANT_ID, MESA_ID);
      await service.abrirSesion(TENANT_ID, MESA_ID);

      const [primera, segunda] = mockTx.mesa.updateMany.mock.calls.map(
        ([args]: any) => args.data.sesionId,
      );
      expect(primera).not.toBe(segunda);
    });

    it.each([
      [MesaEstado.OCUPADA, /ya está abierta/],
      [MesaEstado.EN_PROCESO_DE_PAGO, /ya está abierta/],
      [MesaEstado.REQUIERE_LIMPIEZA, /requiere limpieza/],
    ])('409 si la mesa está %s', async (estado, mensaje) => {
      mockTx.mesa.findUnique.mockResolvedValue(mesa({ estado }));

      await expect(service.abrirSesion(TENANT_ID, MESA_ID)).rejects.toThrow(
        mensaje,
      );
      expect(mockTx.mesa.updateMany).not.toHaveBeenCalled();
      expect(mockKdsGateway.emitirEstadoMesa).not.toHaveBeenCalled();
    });

    it('409 si otro mozo la abrió al mismo tiempo', async () => {
      mockTx.mesa.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.abrirSesion(TENANT_ID, MESA_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(mockKdsGateway.emitirEstadoMesa).not.toHaveBeenCalled();
    });

    it('404 si la mesa no es del tenant; 400 si es la mesa virtual', async () => {
      mockTx.mesa.findUnique.mockResolvedValueOnce(null);
      await expect(service.abrirSesion(TENANT_ID, MESA_ID)).rejects.toThrow(
        NotFoundException,
      );

      mockTx.mesa.findUnique.mockResolvedValueOnce(
        mesa({ estado: MesaEstado.LIBRE, sesionId: null, esVirtual: true }),
      );
      await expect(service.abrirSesion(TENANT_ID, MESA_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('cerrarSesion', () => {
    beforeEach(() => {
      mockTx.__estadoFinal = MesaEstado.REQUIERE_LIMPIEZA;
    });

    it('con todo entregado: REQUIERE_LIMPIEZA, sin sesión, y lo avisa', async () => {
      const { mesa: resultado, pedidosCancelados } = await service.cerrarSesion(
        TENANT_ID,
        MESA_ID,
        MOZO_KEYCLOAK_ID,
      );

      expect(mockTx.pedido.count).toHaveBeenCalledWith({
        where: {
          mesaId: MESA_ID,
          estado: {
            in: [
              PedidoEstado.RECIBIDO,
              PedidoEstado.EN_PREPARACION,
              PedidoEstado.LISTO_PARA_ENTREGAR,
            ],
          },
        },
      });
      expect(mockTx.mesa.updateMany).toHaveBeenCalledWith({
        where: { id: MESA_ID, sesionId: SESION, estado: MesaEstado.OCUPADA },
        data: {
          estado: MesaEstado.REQUIERE_LIMPIEZA,
          sesionId: null,
          sesionAbiertaEn: null,
        },
      });
      expect(mockKdsGateway.emitirEstadoMesa).toHaveBeenCalledWith(
        TENANT_ID,
        MESA_ID,
        MesaEstado.REQUIERE_LIMPIEZA,
      );
      expect(resultado.estado).toBe(MesaEstado.REQUIERE_LIMPIEZA);
      expect(pedidosCancelados).toBe(0);
    });

    it.each([
      [1, /Hay 1 pedido sin entregar/],
      [3, /Hay 3 pedidos sin entregar/],
    ])(
      '409 con %i pedido(s) sin entregar, sin tocar la mesa',
      async (n, mensaje) => {
        mockTx.pedido.count.mockResolvedValue(n);

        await expect(
          service.cerrarSesion(TENANT_ID, MESA_ID, MOZO_KEYCLOAK_ID),
        ).rejects.toThrow(mensaje);
        expect(mockTx.mesa.updateMany).not.toHaveBeenCalled();
        expect(mockKdsGateway.emitirEstadoMesa).not.toHaveBeenCalled();
      },
    );

    it('409 con un pago en curso', async () => {
      mockTx.mesa.findUnique.mockResolvedValue(
        mesa({ estado: MesaEstado.EN_PROCESO_DE_PAGO }),
      );

      await expect(
        service.cerrarSesion(TENANT_ID, MESA_ID, MOZO_KEYCLOAK_ID),
      ).rejects.toThrow(/pago en curso/);
      expect(mockTx.pedido.count).not.toHaveBeenCalled();
    });

    it('409 si la mesa no está abierta', async () => {
      mockTx.mesa.findUnique.mockResolvedValue(
        mesa({ estado: MesaEstado.LIBRE, sesionId: null }),
      );

      await expect(
        service.cerrarSesion(TENANT_ID, MESA_ID, MOZO_KEYCLOAK_ID),
      ).rejects.toThrow(/no está abierta/);
    });

    it('409 si la mesa cambió mientras se cerraba (empezó un cobro)', async () => {
      mockTx.mesa.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.cerrarSesion(TENANT_ID, MESA_ID, MOZO_KEYCLOAK_ID),
      ).rejects.toThrow(ConflictException);
      expect(mockTx.pedido.updateMany).not.toHaveBeenCalled();
      expect(mockKdsGateway.emitirEstadoMesa).not.toHaveBeenCalled();
    });

    it('cancela los pedidos que esperaban el pago, con su historial', async () => {
      mockTx.pedido.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

      const { pedidosCancelados } = await service.cerrarSesion(
        TENANT_ID,
        MESA_ID,
        MOZO_KEYCLOAK_ID,
      );

      expect(mockTx.pedido.findMany).toHaveBeenCalledWith({
        where: { mesaId: MESA_ID, estado: PedidoEstado.PENDIENTE_PAGO },
        select: { id: true },
      });
      expect(mockTx.pedido.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['p1', 'p2'] },
          estado: PedidoEstado.PENDIENTE_PAGO,
        },
        data: { estado: PedidoEstado.CANCELADO },
      });
      expect(mockTx.usuario.findUnique).toHaveBeenCalledWith({
        where: { keycloakId: MOZO_KEYCLOAK_ID },
        select: { id: true },
      });
      expect(mockTx.pedidoEstadoHistorial.createMany).toHaveBeenCalledWith({
        data: ['p1', 'p2'].map((pedidoId) => ({
          tenantId: TENANT_ID,
          pedidoId,
          usuarioId: 'usuario-1',
          estadoAnterior: PedidoEstado.PENDIENTE_PAGO,
          estadoNuevo: PedidoEstado.CANCELADO,
        })),
      });
      expect(pedidosCancelados).toBe(2);
    });
  });

  describe('marcarLimpia', () => {
    it('REQUIERE_LIMPIEZA => LIBRE, y lo avisa', async () => {
      mockTx.mesa.findUnique.mockResolvedValue(
        mesa({ estado: MesaEstado.REQUIERE_LIMPIEZA, sesionId: null }),
      );
      mockTx.__estadoFinal = MesaEstado.LIBRE;

      const resultado = await service.marcarLimpia(TENANT_ID, MESA_ID);

      expect(mockTx.mesa.updateMany).toHaveBeenCalledWith({
        where: { id: MESA_ID, estado: MesaEstado.REQUIERE_LIMPIEZA },
        data: { estado: MesaEstado.LIBRE },
      });
      expect(mockKdsGateway.emitirEstadoMesa).toHaveBeenCalledWith(
        TENANT_ID,
        MESA_ID,
        MesaEstado.LIBRE,
      );
      expect(resultado.estado).toBe(MesaEstado.LIBRE);
    });

    it('409 si la mesa no está esperando limpieza', async () => {
      mockTx.mesa.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.marcarLimpia(TENANT_ID, MESA_ID)).rejects.toThrow(
        /no está esperando limpieza/,
      );
      expect(mockKdsGateway.emitirEstadoMesa).not.toHaveBeenCalled();
    });
  });
});
