import 'reflect-metadata';
import { Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CANTIDAD_RESPALDO,
  ComplementosService,
} from '../../src/complementos/complementos.service';
import { ComplementosController } from '../../src/complementos/complementos.controller';
import { ComplementosThrottlerGuard } from '../../src/complementos/complementos-throttler.guard';
import {
  MAXIMO_PLATOS_EN_PEDIDO,
  PedirComplementosDto,
} from '../../src/complementos/dto/pedir-complementos.dto';

/** HU-046 (BL-552): complementos para el pedido del comensal. */

const TENANT = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE = '22222222-2222-2222-2222-222222222222';
const AHORA = new Date('2026-11-15T15:00:00.000Z');

const plato = (id: string, imagenKey: string | null = null) => ({
  id,
  nombre: `Plato ${id}`,
  descripcion: null,
  precio: new Prisma.Decimal(180),
  imagenKey,
});

describe('ComplementosService', () => {
  let tx: {
    restaurante: { findFirst: jest.Mock };
    itemCarta: { findMany: jest.Mock };
    reglaComplemento: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let storage: { urlImagenPublica: jest.Mock };
  let servicio: ComplementosService;

  beforeEach(() => {
    tx = {
      restaurante: {
        findFirst: jest.fn().mockResolvedValue({ id: RESTAURANTE }),
      },
      itemCarta: { findMany: jest.fn().mockResolvedValue([]) },
      reglaComplemento: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    storage = {
      urlImagenPublica: jest.fn((key: string) =>
        Promise.resolve(`https://cdn/${key}`),
      ),
    };
    servicio = new ComplementosService(
      { runInTenantContext: jest.fn((_t, fn) => fn(tx)) } as any,
      storage as any,
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('solo busca platos del local, disponibles, sugeribles, sin alcohol, no archivados y que no estén en el pedido', async () => {
    await servicio.sugerir(TENANT, RESTAURANTE, ['a', 'a', 'b'], AHORA);
    expect(tx.itemCarta.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: TENANT,
          archivadoEn: null,
          disponible: true,
          sugerible: true,
          contieneAlcohol: false,
          id: { notIn: ['a', 'b'] },
          categoria: {
            restauranteId: RESTAURANTE,
            activo: true,
            archivadaEn: null,
          },
        },
      }),
    );
  });

  it('un restaurante que no es del tenant: 404 genérico', async () => {
    tx.restaurante.findFirst.mockResolvedValue(null);
    await expect(
      servicio.sugerir(TENANT, RESTAURANTE, ['a'], AHORA),
    ).rejects.toThrow(NotFoundException);
    expect(tx.restaurante.findFirst).toHaveBeenCalledWith({
      where: { id: RESTAURANTE, tenantId: TENANT },
      select: { id: true },
    });
  });

  it('sin candidatos no consulta reglas y no sugiere nada', async () => {
    await expect(
      servicio.sugerir(TENANT, RESTAURANTE, ['a'], AHORA),
    ).resolves.toEqual({ origen: 'ninguno', sugerencias: [] });
    expect(tx.reglaComplemento.findMany).not.toHaveBeenCalled();
  });

  it('con reglas: hasta 2, por lift × confianza, solo con datos del plato', async () => {
    tx.itemCarta.findMany.mockResolvedValue([
      plato('flan', 'flan.webp'),
      plato('agua'),
      plato('cafe'),
    ]);
    tx.reglaComplemento.findMany.mockResolvedValue([
      { consecuenteId: 'cafe', confianza: 0.3, lift: 1.5 },
      { consecuenteId: 'flan', confianza: 0.5, lift: 3 },
      { consecuenteId: 'agua', confianza: 0.4, lift: 2 },
    ]);

    const respuesta = await servicio.sugerir(
      TENANT,
      RESTAURANTE,
      ['milanesa'],
      AHORA,
    );

    expect(tx.reglaComplemento.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT,
        antecedenteId: { in: ['milanesa'] },
        consecuenteId: { in: ['flan', 'agua', 'cafe'] },
      },
      select: { consecuenteId: true, confianza: true, lift: true },
    });
    expect(respuesta).toEqual({
      origen: 'reglas',
      sugerencias: [
        {
          id: 'flan',
          nombre: 'Plato flan',
          descripcion: null,
          precio: new Prisma.Decimal(180),
          imagenUrl: 'https://cdn/flan.webp',
        },
        {
          id: 'agua',
          nombre: 'Plato agua',
          descripcion: null,
          precio: new Prisma.Decimal(180),
          imagenUrl: null,
        },
      ],
    });
    // No se consulta la popularidad.
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('sin reglas: el más pedido entre los candidatos (uno solo)', async () => {
    expect(CANTIDAD_RESPALDO).toBe(1);
    tx.itemCarta.findMany.mockResolvedValue([plato('flan'), plato('agua')]);
    tx.$queryRaw.mockResolvedValue([
      { item_carta_id: 'agua' },
      { item_carta_id: 'flan' },
    ]);

    const respuesta = await servicio.sugerir(
      TENANT,
      RESTAURANTE,
      ['milanesa'],
      AHORA,
    );

    expect(respuesta.origen).toBe('popularidad');
    expect(respuesta.sugerencias.map((s) => s.id)).toEqual(['agua']);
  });

  it('sin fecha usa la de ahora para la popularidad', async () => {
    tx.itemCarta.findMany.mockResolvedValue([plato('flan')]);
    tx.$queryRaw.mockResolvedValue([{ item_carta_id: 'flan' }]);
    const respuesta = await servicio.sugerir(TENANT, RESTAURANTE, ['milanesa']);
    expect(respuesta.origen).toBe('popularidad');
  });

  it('sin reglas ni ventas suficientes, o si falla la consulta de popularidad, no sugiere nada', async () => {
    tx.itemCarta.findMany.mockResolvedValue([plato('flan')]);
    await expect(
      servicio.sugerir(TENANT, RESTAURANTE, ['milanesa'], AHORA),
    ).resolves.toEqual({ origen: 'ninguno', sugerencias: [] });

    tx.$queryRaw.mockRejectedValue(new Error('se cortó'));
    await expect(
      servicio.sugerir(TENANT, RESTAURANTE, ['milanesa'], AHORA),
    ).resolves.toEqual({ origen: 'ninguno', sugerencias: [] });
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });
});

describe('ComplementosController', () => {
  let complementos: { sugerir: jest.Mock };
  let qr: { resolver: jest.Mock };
  let estado: { asegurarActivo: jest.Mock };
  let controller: ComplementosController;
  const dto = { itemsEnPedido: ['a'] };

  beforeEach(() => {
    complementos = {
      sugerir: jest
        .fn()
        .mockResolvedValue({ origen: 'ninguno', sugerencias: [] }),
    };
    qr = { resolver: jest.fn() };
    estado = { asegurarActivo: jest.fn().mockResolvedValue(undefined) };
    controller = new ComplementosController(
      complementos as any,
      qr as any,
      estado as any,
    );
  });

  it('por QR: valida el token, el estado del local y la sesión, y usa la mesa del QR', async () => {
    qr.resolver.mockResolvedValue({
      tenantId: TENANT,
      mesaId: 'm1',
      restauranteId: RESTAURANTE,
      sesionId: 's1',
    });
    await controller.porQr('token', dto);
    expect(qr.resolver).toHaveBeenCalledWith('token');
    expect(estado.asegurarActivo).toHaveBeenCalledWith(
      TENANT,
      expect.any(String),
    );
    expect(complementos.sugerir).toHaveBeenCalledWith(TENANT, RESTAURANTE, [
      'a',
    ]);
  });

  it('por QR con la mesa cerrada: no sugiere', async () => {
    qr.resolver.mockResolvedValue({
      tenantId: TENANT,
      mesaId: 'm1',
      restauranteId: RESTAURANTE,
      sesionId: null,
    });
    await expect(controller.porQr('token', dto)).rejects.toThrow();
    expect(complementos.sugerir).not.toHaveBeenCalled();
  });

  it('por enlace: valida el estado del local y pasa los ids', async () => {
    await controller.porEnlace(TENANT, RESTAURANTE, dto);
    expect(estado.asegurarActivo).toHaveBeenCalledWith(
      TENANT,
      expect.any(String),
    );
    expect(complementos.sugerir).toHaveBeenCalledWith(TENANT, RESTAURANTE, [
      'a',
    ]);
  });

  it('un local suspendido no sugiere', async () => {
    estado.asegurarActivo.mockRejectedValue(new Error('suspendido'));
    await expect(
      controller.porEnlace(TENANT, RESTAURANTE, dto),
    ).rejects.toThrow('suspendido');
    expect(complementos.sugerir).not.toHaveBeenCalled();
  });
});

describe('ComplementosThrottlerGuard', () => {
  const tracker = (req: object) =>
    (
      ComplementosThrottlerGuard.prototype as unknown as {
        getTracker: (r: object) => Promise<string>;
      }
    ).getTracker(req);

  it('por QR cuenta por el hash del token, nunca por el token', async () => {
    const valor = await tracker({ params: { token: 'secreto' } });
    expect(valor).toMatch(/^complementos:qr:[0-9a-f]{64}$/);
    expect(valor).not.toContain('secreto');
  });

  it('por enlace cuenta por local', async () => {
    await expect(
      tracker({ params: { tenantId: TENANT, restauranteId: RESTAURANTE } }),
    ).resolves.toBe(`complementos:local:${RESTAURANTE}`);
    await expect(tracker({})).resolves.toBe('complementos:local:');
  });
});

describe('PedirComplementosDto', () => {
  const errores = async (plano: object) =>
    (await validate(plainToInstance(PedirComplementosDto, plano))).map(
      (e) => e.property,
    );
  const ID = '44444444-4444-4444-4444-444444444444';

  it('acepta de 1 a 50 ids de platos', async () => {
    expect(await errores({ itemsEnPedido: [ID] })).toEqual([]);
    expect(
      await errores({
        itemsEnPedido: Array.from(
          { length: MAXIMO_PLATOS_EN_PEDIDO },
          () => ID,
        ),
      }),
    ).toEqual([]);
  });

  it.each([
    [{}],
    [{ itemsEnPedido: [] }],
    [{ itemsEnPedido: ['no-es-un-id'] }],
    [{ itemsEnPedido: ID }],
    [{ itemsEnPedido: Array.from({ length: 51 }, () => ID) }],
  ])('rechaza %p', async (plano) => {
    expect(await errores(plano)).toEqual(['itemsEnPedido']);
  });
});
