import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PedidosDeLaMesaService } from '../../src/pedidos/pedidos-de-la-mesa.service';
import { PedidosController } from '../../src/pedidos/pedidos.controller';
import {
  EstadoPedidosMesaDto,
  MAXIMO_PEDIDOS_POR_CONSULTA,
} from '../../src/pedidos/dto/estado-pedidos-mesa.dto';
import { MARGEN_RELOJ_SESION_MS } from '../../src/pedidos/pedido-acceso.guard';

// BL-502: «Mis pedidos» del comensal en la mesa.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const PEDIDO_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PEDIDO_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ABIERTA = new Date('2026-11-10T22:00:00.000Z');

const mesa = (sesionAbiertaEn: Date | null = ABIERTA) => ({
  tenantId: TENANT_ID,
  mesaId: MESA_ID,
  restauranteId: '22222222-2222-2222-2222-222222222222',
  numero: 4,
  sesionId: '99999999-9999-4999-8999-999999999999',
  sesionAbiertaEn,
});

describe('PedidosDeLaMesaService (BL-502)', () => {
  let findMany: jest.Mock;
  let runInTenantContext: jest.Mock;
  let service: PedidosDeLaMesaService;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    runInTenantContext = jest.fn((_t: string, fn: (tx: unknown) => unknown) =>
      fn({ pedido: { findMany } }),
    );
    service = new PedidosDeLaMesaService({ runInTenantContext } as any);
  });

  it('busca solo en la mesa del QR, en el canal QR y desde la apertura de la sesión (con el margen de relojes), en el tenant del QR', async () => {
    await service.estado(mesa(), [PEDIDO_A, PEDIDO_B]);

    expect(runInTenantContext).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Function),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: [PEDIDO_A, PEDIDO_B] },
          mesaId: MESA_ID,
          canal: 'QR',
          createdAt: {
            gte: new Date(ABIERTA.getTime() - MARGEN_RELOJ_SESION_MS),
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('sin fecha de apertura no filtra por fecha; sin ids no consulta', async () => {
    await service.estado(mesa(null), [PEDIDO_A]);
    expect(findMany.mock.calls[0][0].where).not.toHaveProperty('createdAt');

    findMany.mockClear();
    await expect(service.estado(mesa(), [])).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('devuelve estado, horas, líneas y totales, sin datos de pago ni del CFE', async () => {
    findMany.mockResolvedValue([
      {
        id: PEDIDO_A,
        estado: 'EN_PREPARACION',
        createdAt: new Date('2026-11-10T23:41:00.000Z'),
        updatedAt: new Date('2026-11-10T23:45:00.000Z'),
        propinaMonto: 71,
        lineas: [
          {
            nombreSnapshot: 'Milanesa con papas',
            cantidad: 1,
            subtotal: new Prisma.Decimal('590'),
          },
          {
            nombreSnapshot: 'Agua',
            cantidad: 2,
            subtotal: new Prisma.Decimal('240.5'),
          },
        ],
      },
      {
        id: PEDIDO_B,
        estado: 'ENTREGADO',
        createdAt: new Date('2026-11-10T23:18:00.000Z'),
        updatedAt: new Date('2026-11-10T23:30:00.000Z'),
        propinaMonto: null,
        lineas: [],
      },
    ]);

    await expect(service.estado(mesa(), [PEDIDO_A, PEDIDO_B])).resolves.toEqual(
      [
        {
          id: PEDIDO_A,
          estado: 'EN_PREPARACION',
          creadoEn: '2026-11-10T23:41:00.000Z',
          actualizadoEn: '2026-11-10T23:45:00.000Z',
          lineas: [
            { nombre: 'Milanesa con papas', cantidad: 1 },
            { nombre: 'Agua', cantidad: 2 },
          ],
          consumo: '830.50',
          propina: 71,
        },
        {
          id: PEDIDO_B,
          estado: 'ENTREGADO',
          creadoEn: '2026-11-10T23:18:00.000Z',
          actualizadoEn: '2026-11-10T23:30:00.000Z',
          lineas: [],
          consumo: '0.00',
          propina: 0,
        },
      ],
    );
    const select = findMany.mock.calls[0][0].select;
    expect(Object.keys(select).sort()).toEqual([
      'createdAt',
      'estado',
      'id',
      'lineas',
      'propinaMonto',
      'updatedAt',
    ]);
  });
});

describe('PedidosController.estadoEnLaMesa (BL-502)', () => {
  it('consulta con la mesa validada por el guard, nunca con una del body', async () => {
    const respuesta = [{ id: PEDIDO_A }];
    const pedidosDeLaMesa = { estado: jest.fn().mockResolvedValue(respuesta) };
    const controller = new PedidosController({} as any, pedidosDeLaMesa as any);

    await expect(
      controller.estadoEnLaMesa({ ids: [PEDIDO_A] }, mesa() as any),
    ).resolves.toBe(respuesta);
    expect(pedidosDeLaMesa.estado).toHaveBeenCalledWith(mesa(), [PEDIDO_A]);
  });
});

describe('EstadoPedidosMesaDto (BL-502)', () => {
  const errores = async (datos: Record<string, unknown>) =>
    (await validate(plainToInstance(EstadoPedidosMesaDto, datos))).flatMap(
      (e) => Object.values(e.constraints ?? {}),
    );

  it('una lista de UUID sin repetir, de hasta 30', async () => {
    expect(await errores({ ids: [PEDIDO_A, PEDIDO_B] })).toEqual([]);
    expect(await errores({ ids: [] })).toEqual([]);
    expect(await errores({ ids: 'x' })).toContain(
      'ids tiene que ser una lista',
    );
    expect(await errores({ ids: [PEDIDO_A, PEDIDO_A] })).toEqual([
      'ids tiene pedidos repetidos',
    ]);
    expect(await errores({ ids: ['no-es-uuid'] })).toEqual([
      'Cada id tiene que ser un UUID',
    ]);
    const muchos = Array.from(
      { length: MAXIMO_PEDIDOS_POR_CONSULTA + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(await errores({ ids: muchos })).toEqual([
      'Se pueden consultar hasta 30 pedidos',
    ]);
  });
});
