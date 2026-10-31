import { Decimal } from '@prisma/client/runtime/library';
import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RolesGuard } from '../../src/auth/roles.guard';
import { PedidosService } from '../../src/pedidos/pedidos.service';
import { PedidosController } from '../../src/pedidos/pedidos.controller';
import { CrearPedidoMozoDto } from '../../src/pedidos/dto/crear-pedido-mozo.dto';

// HU-039 (BL-209): el mozo carga el pedido de un comensal sin celular.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const ACTOR = '44444444-4444-4444-8444-444444444444';

const dto = (overrides: Partial<CrearPedidoMozoDto> = {}) =>
  ({
    mesaId: MESA_ID,
    idempotencyKey: 'mozo-1',
    items: [{ itemCartaId: ITEM_ID, cantidad: 2, observacion: 'Sin sal' }],
    observacionGeneral: 'Celíaco',
    ...overrides,
  }) as CrearPedidoMozoDto;

function pedidoGuardado(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pedido-1',
    canal: 'MOZO',
    estado: 'PENDIENTE_PAGO',
    createdAt: new Date('2026-10-28T18:00:00.000Z'),
    mesa: { id: MESA_ID, numero: 3, esVirtual: false },
    lineas: [
      {
        id: 'l-1',
        nombreSnapshot: 'Milanesa',
        cantidad: 2,
        subtotal: new Decimal('1180'),
      },
    ],
    ...overrides,
  };
}

describe('PedidosService.crearPorMozo (HU-039, BL-209)', () => {
  let tx: any;
  let service: PedidosService;

  beforeEach(() => {
    tx = {
      pedido: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(pedidoGuardado()),
      },
      mesa: {
        findUnique: jest.fn().mockResolvedValue({
          id: MESA_ID,
          restauranteId: RESTAURANTE_ID,
          esVirtual: false,
          sesionId: 'sesion-1',
        }),
      },
      itemCarta: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: ITEM_ID,
            nombre: 'Milanesa',
            precio: new Decimal('590'),
            disponible: true,
          },
        ]),
      },
      usuario: { findUnique: jest.fn().mockResolvedValue({ id: 'u-mozo' }) },
    };
    service = new PedidosService(
      { runInTenantContext: jest.fn((_t, fn) => fn(tx)) } as any,
      {} as any,
    );
  });

  const crear = (body = dto(), actor = ACTOR) =>
    service.crearPorMozo(TENANT_ID, actor, body);

  it('crea el pedido en PENDIENTE_PAGO, canal MOZO, con quién lo cargó y el snapshot de la carta', async () => {
    await crear();

    expect(tx.pedido.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId: MESA_ID,
          usuarioId: 'u-mozo',
          idempotencyKey: 'mozo-1',
          estado: 'PENDIENTE_PAGO',
          canal: 'MOZO',
          observacionGeneral: 'Celíaco',
          lineas: {
            create: [
              {
                tenantId: TENANT_ID,
                itemCartaId: ITEM_ID,
                nombreSnapshot: 'Milanesa',
                precioUnitarioSnapshot: new Decimal('590'),
                cantidad: 2,
                subtotal: new Decimal('1180'),
                observacion: 'Sin sal',
              },
            ],
          },
        },
      }),
    );
  });

  it('devuelve el pedido con la forma de «Cobros pendientes» (para cobrarlo enseguida)', async () => {
    await expect(crear()).resolves.toEqual({
      id: 'pedido-1',
      canal: 'MOZO',
      estado: 'PENDIENTE_PAGO',
      createdAt: new Date('2026-10-28T18:00:00.000Z'),
      mesa: { id: MESA_ID, numero: 3, esVirtual: false },
      total: '1180.00',
      lineas: [
        { id: 'l-1', nombre: 'Milanesa', cantidad: 2, subtotal: '1180.00' },
      ],
      pagoEnCurso: false,
      efectivoSolicitado: null,
    });
  });

  it('actor sin fila en usuario: el pedido queda sin usuario', async () => {
    tx.usuario.findUnique.mockResolvedValue(null);

    await crear();

    expect(tx.pedido.create.mock.calls[0][0].data.usuarioId).toBeNull();
  });

  it('actor que no es un UUID (un script): ni se busca el usuario', async () => {
    await crear(dto(), 'script:test');

    expect(tx.usuario.findUnique).not.toHaveBeenCalled();
    expect(tx.pedido.create.mock.calls[0][0].data.usuarioId).toBeNull();
  });

  describe('idempotencia (RNF.03)', () => {
    it('misma clave: devuelve el pedido ya creado, sin crear otro', async () => {
      tx.pedido.findUnique.mockResolvedValue(pedidoGuardado());

      const r = await crear();

      expect(r.id).toBe('pedido-1');
      expect(tx.pedido.create).not.toHaveBeenCalled();
    });

    it('la clave es de un pedido del comensal (otro canal): 409', async () => {
      tx.pedido.findUnique.mockResolvedValue(pedidoGuardado({ canal: 'QR' }));

      await expect(crear()).rejects.toThrow(ConflictException);
    });

    it('la clave es de un pedido de otra mesa: 409', async () => {
      tx.pedido.findUnique.mockResolvedValue(
        pedidoGuardado({ mesa: { id: 'otra', numero: 9, esVirtual: false } }),
      );

      await expect(crear()).rejects.toThrow(ConflictException);
    });
  });

  it('mesa inexistente en el tenant (RLS): 404', async () => {
    tx.mesa.findUnique.mockResolvedValue(null);

    await expect(crear()).rejects.toThrow(NotFoundException);
  });

  it('mesa virtual (pedidos para retirar): 404', async () => {
    tx.mesa.findUnique.mockResolvedValue({
      id: MESA_ID,
      restauranteId: RESTAURANTE_ID,
      esVirtual: true,
      sesionId: null,
    });

    await expect(crear()).rejects.toThrow(NotFoundException);
  });

  it('mesa cerrada (sin sesión, HU-017): 409 y no crea nada', async () => {
    tx.mesa.findUnique.mockResolvedValue({
      id: MESA_ID,
      restauranteId: RESTAURANTE_ID,
      esVirtual: false,
      sesionId: null,
    });

    await expect(crear()).rejects.toThrow(
      new ConflictException(
        'La mesa está cerrada: abrila para cargar un pedido',
      ),
    );
    expect(tx.pedido.create).not.toHaveBeenCalled();
  });

  it('ítem que no está en la carta: 400', async () => {
    tx.itemCarta.findMany.mockResolvedValue([]);

    await expect(crear()).rejects.toThrow(BadRequestException);
  });

  it('ítem no disponible: 400 con el nombre', async () => {
    tx.itemCarta.findMany.mockResolvedValue([
      {
        id: ITEM_ID,
        nombre: 'Milanesa',
        precio: new Decimal('590'),
        disponible: false,
      },
    ]);

    await expect(crear()).rejects.toThrow(
      new BadRequestException('"Milanesa" no está disponible'),
    );
  });
});

describe('PedidosController.crearPorMozo (HU-039, BL-209)', () => {
  it('pasa el tenant y el actor del token', async () => {
    const pedidos = { crearPorMozo: jest.fn() };
    const controller = new PedidosController(pedidos as any);

    await controller.crearPorMozo(
      { user: { tenantId: TENANT_ID, sub: ACTOR, roles: ['MOZO'] } } as any,
      dto(),
    );

    expect(pedidos.crearPorMozo).toHaveBeenCalledWith(TENANT_ID, ACTOR, dto());
  });

  const guard = new RolesGuard(new Reflector());
  const contexto = (roles: string[]) =>
    ({
      getHandler: () => PedidosController.prototype.crearPorMozo,
      getClass: () => PedidosController,
      switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
    }) as unknown as ExecutionContext;

  it.each([['ADMIN'], ['MOZO']])('%s puede cargar pedidos', (rol) => {
    expect(guard.canActivate(contexto([rol]))).toBe(true);
  });

  it.each([['COCINA'], ['COMENSAL'], ['PLATAFORMA']])(
    '%s recibe 403',
    (rol) => {
      expect(() => guard.canActivate(contexto([rol]))).toThrow(
        ForbiddenException,
      );
    },
  );
});

describe('CrearPedidoMozoDto (HU-039, BL-209)', () => {
  const errores = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(CrearPedidoMozoDto, body))).map(
      (e) => e.property,
    );

  it('acepta un pedido válido', async () => {
    expect(await errores({ ...dto() })).toEqual([]);
  });

  it('exige mesaId UUID y al menos un ítem', async () => {
    const r = await errores({ ...dto(), mesaId: 'mesa-3', items: [] });
    expect(r.sort()).toEqual(['items', 'mesaId']);
  });

  it('no acepta restauranteId (sale de la mesa)', async () => {
    const instancia = plainToInstance(CrearPedidoMozoDto, {
      ...dto(),
      restauranteId: RESTAURANTE_ID,
    });
    const r = await validate(instancia, {
      forbidNonWhitelisted: true,
      whitelist: true,
    });
    expect(r.map((e) => e.property)).toEqual(['restauranteId']);
  });

  it('limpia el HTML de las observaciones (igual que el pedido del comensal)', () => {
    const instancia = plainToInstance(CrearPedidoMozoDto, {
      ...dto(),
      observacionGeneral: '<b>Celíaco</b>',
    });
    expect(instancia.observacionGeneral).toBe('Celíaco');
  });
});
