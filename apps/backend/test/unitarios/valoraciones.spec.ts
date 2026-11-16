import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ValorarPedidoDto } from '../../src/valoraciones/dto/valorar-pedido.dto';
import { FiltrosValoracionesDto } from '../../src/valoraciones/dto/filtros-valoraciones.dto';
import {
  CODIGO_YA_VALORADO,
  LARGO_MAXIMO_COMENTARIO,
  limpiarComentario,
  MAXIMO_COMENTARIOS,
  MENSAJE_AUN_NO_ENTREGADO,
  resumirValoraciones,
} from '../../src/valoraciones/valoracion';
import { ValoracionesService } from '../../src/valoraciones/valoraciones.service';
import { ValoracionThrottlerGuard } from '../../src/valoraciones/valoracion-throttler.guard';
import { ValoracionPedidoController } from '../../src/valoraciones/valoracion-pedido.controller';
import { ValoracionesAdminController } from '../../src/valoraciones/valoraciones-admin.controller';
import { PERMITE_LINK_PAGADO } from '../../src/pedidos/pedido-acceso.guard';

/** HU-050 (BL-558): valoración privada del pedido. */

const TENANT = '11111111-1111-1111-1111-111111111111';
const PEDIDO = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';
// 15/11 a las 23:30 en Montevideo: en UTC ya es 16/11; el día es el del local.
const AHORA = new Date('2026-11-16T02:30:00.000Z');

describe('limpiarComentario', () => {
  it('[TC-U-578] saca las etiquetas (también las que se arman al sacar otra) y recorta', () => {
    expect(limpiarComentario('  <b>Muy</b> rico  ')).toBe('Muy rico');
    const armado = limpiarComentario('<<b>script>alert(1)<</b>/script>');
    expect(armado).not.toMatch(/<[a-z/]/i);
    expect(armado).toContain('alert(1)');
  });

  it('un «<» sin cierre queda como texto', () => {
    expect(limpiarComentario('lo amé <3')).toBe('lo amé <3');
  });

  it('vacío, solo espacios o solo etiquetas: sin comentario', () => {
    expect(limpiarComentario('')).toBeNull();
    expect(limpiarComentario('   ')).toBeNull();
    expect(limpiarComentario('<p></p>')).toBeNull();
    expect(limpiarComentario(42)).toBeNull();
  });
});

describe('resumirValoraciones', () => {
  it('[TC-U-579] promedio con un decimal y las cinco barras, de 5 a 1', () => {
    expect(
      resumirValoraciones([
        { estrellas: 5, cantidad: 3 },
        { estrellas: 4, cantidad: 1 },
        { estrellas: 1, cantidad: 1 },
      ]),
    ).toEqual({
      total: 5,
      promedio: 4,
      distribucion: [
        { estrellas: 5, cantidad: 3 },
        { estrellas: 4, cantidad: 1 },
        { estrellas: 3, cantidad: 0 },
        { estrellas: 2, cantidad: 0 },
        { estrellas: 1, cantidad: 1 },
      ],
    });
    expect(
      resumirValoraciones([
        { estrellas: 5, cantidad: 2 },
        { estrellas: 4, cantidad: 1 },
      ]).promedio,
    ).toBe(4.7);
  });

  it('sin valoraciones: promedio null y todo en 0', () => {
    const resumen = resumirValoraciones([]);
    expect(resumen.total).toBe(0);
    expect(resumen.promedio).toBeNull();
    expect(resumen.distribucion.every((d) => d.cantidad === 0)).toBe(true);
  });
});

describe('ValorarPedidoDto', () => {
  const errores = async (cuerpo: unknown) =>
    (await validate(plainToInstance(ValorarPedidoDto, cuerpo))).map(
      (e) => e.property,
    );

  it('[TC-U-580] acepta de 1 a 5 y rechaza 0, 6, decimales y texto', async () => {
    expect(await errores({ estrellas: 1 })).toEqual([]);
    expect(await errores({ estrellas: 5 })).toEqual([]);
    for (const estrellas of [0, 6, 3.5, '4', undefined]) {
      expect(await errores({ estrellas })).toEqual(['estrellas']);
    }
  });

  it('comentario: hasta el máximo, limpio; vacío queda sin comentario', async () => {
    const dto = plainToInstance(ValorarPedidoDto, {
      estrellas: 4,
      comentario: '  <i>bien</i> ',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.comentario).toBe('bien');
    expect(
      plainToInstance(ValorarPedidoDto, { estrellas: 4, comentario: '  ' })
        .comentario,
    ).toBeUndefined();
    expect(
      await errores({
        estrellas: 4,
        comentario: 'a'.repeat(LARGO_MAXIMO_COMENTARIO + 1),
      }),
    ).toEqual(['comentario']);
    expect(await errores({ estrellas: 4, comentario: 12 })).toEqual([
      'comentario',
    ]);
  });
});

describe('ValoracionesService', () => {
  let tx: any;
  let service: ValoracionesService;

  beforeEach(() => {
    tx = {
      pedido: { findUnique: jest.fn() },
      restaurante: { findFirst: jest.fn() },
      valoracionPedido: {
        create: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new ValoracionesService({
      runInTenantContext: jest.fn((_t, fn) => fn(tx)),
    } as any);
  });

  describe('valorar', () => {
    const entregado = {
      estado: 'ENTREGADO',
      restaurante: { timezone: 'America/Montevideo' },
    };

    it('[TC-U-581] pedido entregado: guarda las estrellas, el comentario y solo el día del local', async () => {
      tx.pedido.findUnique.mockResolvedValue(entregado);

      await expect(
        service.valorar(
          TENANT,
          PEDIDO,
          { estrellas: 4, comentario: 'Rico' },
          AHORA,
        ),
      ).resolves.toEqual({ valorado: true });
      expect(tx.valoracionPedido.create).toHaveBeenCalledWith({
        data: {
          pedidoId: PEDIDO,
          tenantId: TENANT,
          dia: new Date('2026-11-15T00:00:00.000Z'),
          estrellas: 4,
          comentario: 'Rico',
        },
      });
    });

    it('sin comentario guarda null', async () => {
      tx.pedido.findUnique.mockResolvedValue(entregado);
      await service.valorar(TENANT, PEDIDO, { estrellas: 2 }, AHORA);
      expect(tx.valoracionPedido.create.mock.calls[0][0].data.comentario).toBe(
        null,
      );
    });

    it('[TC-U-582] pedido que todavía no se entregó: 409 y no guarda nada', async () => {
      for (const estado of [
        'PENDIENTE_PAGO',
        'RECIBIDO',
        'LISTO_PARA_ENTREGAR',
        'CANCELADO',
      ]) {
        tx.pedido.findUnique.mockResolvedValue({ ...entregado, estado });
        await expect(
          service.valorar(TENANT, PEDIDO, { estrellas: 5 }, AHORA),
        ).rejects.toThrow(new ConflictException(MENSAJE_AUN_NO_ENTREGADO));
      }
      expect(tx.valoracionPedido.create).not.toHaveBeenCalled();
    });

    it('pedido que no existe en el tenant: 404', async () => {
      tx.pedido.findUnique.mockResolvedValue(null);
      await expect(
        service.valorar(TENANT, PEDIDO, { estrellas: 5 }, AHORA),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('[TC-U-583] segunda valoración del mismo pedido: 409 con el código YA_VALORADO', async () => {
      tx.pedido.findUnique.mockResolvedValue(entregado);
      tx.valoracionPedido.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );

      const error = await service
        .valorar(TENANT, PEDIDO, { estrellas: 5 }, AHORA)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        codigo: CODIGO_YA_VALORADO,
      });
    });

    it('otro error de la base no se disfraza', async () => {
      tx.pedido.findUnique.mockResolvedValue(entregado);
      tx.valoracionPedido.create.mockRejectedValue(new Error('caída'));
      await expect(
        service.valorar(TENANT, PEDIDO, { estrellas: 5 }, AHORA),
      ).rejects.toThrow('caída');
    });
  });

  describe('listar', () => {
    beforeEach(() => {
      tx.restaurante.findFirst.mockResolvedValue({
        timezone: 'America/Montevideo',
      });
    });

    it('[TC-U-584] resumen del período, sin el pedido ni la mesa, con tope de comentarios', async () => {
      tx.valoracionPedido.groupBy.mockResolvedValue([
        { estrellas: 5, _count: { _all: 2 } },
        { estrellas: 3, _count: { _all: 1 } },
      ]);
      tx.valoracionPedido.count.mockResolvedValue(1);
      tx.valoracionPedido.findMany.mockResolvedValue([
        {
          dia: new Date('2026-11-14T00:00:00.000Z'),
          estrellas: 3,
          comentario: 'Tardó',
        },
      ]);

      const resultado = await service.listar(
        TENANT,
        { periodo: 'ULTIMOS_7_DIAS' },
        AHORA,
      );

      expect(resultado).toEqual({
        rango: {
          desde: '2026-11-09',
          hasta: '2026-11-15',
          timezone: 'America/Montevideo',
        },
        total: 3,
        promedio: 4.3,
        distribucion: [
          { estrellas: 5, cantidad: 2 },
          { estrellas: 4, cantidad: 0 },
          { estrellas: 3, cantidad: 1 },
          { estrellas: 2, cantidad: 0 },
          { estrellas: 1, cantidad: 0 },
        ],
        comentarios: [{ dia: '2026-11-14', estrellas: 3, comentario: 'Tardó' }],
        totalComentarios: 1,
      });
      const consulta = tx.valoracionPedido.findMany.mock.calls[0][0];
      expect(consulta.take).toBe(MAXIMO_COMENTARIOS);
      expect(consulta.select).toEqual({
        dia: true,
        estrellas: true,
        comentario: true,
      });
      expect(consulta.where).toMatchObject({
        tenantId: TENANT,
        dia: {
          gte: new Date('2026-11-09T00:00:00.000Z'),
          lte: new Date('2026-11-15T00:00:00.000Z'),
        },
        comentario: { not: null },
      });
    });

    it('sin restaurante: 404', async () => {
      tx.restaurante.findFirst.mockResolvedValue(null);
      await expect(
        service.listar(TENANT, { periodo: 'HOY' }, AHORA),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('ValoracionThrottlerGuard.getTracker', () => {
  it('[TC-U-585] cuenta por pedido, no por IP', async () => {
    const guard = Object.create(
      ValoracionThrottlerGuard.prototype,
    ) as ValoracionThrottlerGuard;
    const tracker = (req: Record<string, unknown>) =>
      (guard as any).getTracker(req) as Promise<string>;

    await expect(
      tracker({ ip: '1.1.1.1', params: { pedidoId: PEDIDO } }),
    ).resolves.toBe(`valoracion:pedido:${PEDIDO}`);
    await expect(tracker({ ip: '1.1.1.1', params: {} })).resolves.toBe(
      'valoracion:pedido:',
    );
  });
});

describe('controllers de valoraciones', () => {
  const user = { sub: 'x', tenantId: TENANT, roles: [] } as any;

  it('[TC-U-590] el comensal valora con el tenant del token y la ruta acepta el link de un pedido pagado', async () => {
    const valorar = jest.fn().mockResolvedValue({ valorado: true });
    const controller = new ValoracionPedidoController({ valorar } as any);

    await expect(
      controller.valorar({ user }, PEDIDO, { estrellas: 5 }),
    ).resolves.toEqual({ valorado: true });
    expect(valorar).toHaveBeenCalledWith(TENANT, PEDIDO, { estrellas: 5 });
    expect(
      Reflect.getMetadata(
        PERMITE_LINK_PAGADO,
        ValoracionPedidoController.prototype.valorar,
      ),
    ).toBe(true);
  });

  it('el administrador lista con el tenant del token', async () => {
    const listar = jest.fn().mockResolvedValue({ total: 0 });
    const controller = new ValoracionesAdminController({ listar } as any);

    await controller.listar({ user }, { periodo: 'HOY' });
    expect(listar).toHaveBeenCalledWith(TENANT, { periodo: 'HOY' });
  });
});

describe('FiltrosValoracionesDto', () => {
  const errores = async (consulta: unknown) =>
    (await validate(plainToInstance(FiltrosValoracionesDto, consulta))).map(
      (e) => e.property,
    );

  it('sin filtros, los últimos 7 días; personalizado exige las dos fechas', async () => {
    expect(plainToInstance(FiltrosValoracionesDto, {}).periodo).toBe(
      'ULTIMOS_7_DIAS',
    );
    expect(await errores({})).toEqual([]);
    expect(await errores({ periodo: 'SIEMPRE' })).toEqual(['periodo']);
    expect(await errores({ periodo: 'PERSONALIZADO' })).toEqual([
      'desde',
      'hasta',
    ]);
    expect(
      await errores({
        periodo: 'PERSONALIZADO',
        desde: '2026-11-01',
        hasta: '2026-11-15',
      }),
    ).toEqual([]);
  });
});
