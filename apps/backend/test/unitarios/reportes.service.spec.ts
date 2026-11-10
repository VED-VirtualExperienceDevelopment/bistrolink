import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReportesService } from '../../src/reportes/reportes.service';
import { FiltrosReportesDto } from '../../src/reportes/dto/filtros-reportes.dto';

// HU-012 (BL-108): métricas del dashboard. Las consultas contra la base se
// prueban en la integración (reportes.e2e-spec); acá, cómo se arma la
// respuesta y qué se filtra.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
// 2 de noviembre, 17:00 en Montevideo.
const AHORA = new Date('2026-11-02T20:00:00.000Z');

function filtros(
  valores: Partial<FiltrosReportesDto> = {},
): FiltrosReportesDto {
  return Object.assign(new FiltrosReportesDto(), valores);
}

const decimal = (valor: number) => new Prisma.Decimal(valor);

describe('ReportesService', () => {
  let tx: {
    $queryRaw: jest.Mock;
    restaurante: { findFirst: jest.Mock };
    mesa: { count: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let service: ReportesService;

  // Respuestas de cada consulta, por la tabla y lo que calcula.
  let porCanal: unknown[];
  let porCanalAnterior: unknown[];
  let porHora: unknown[];
  let platos: unknown[];
  let rotacion: unknown[];

  /** El SQL (normalizado) de cada consulta que se hizo. */
  function consultas(): { sql: string; values: unknown[] }[] {
    return tx.$queryRaw.mock.calls.map(([sql]: [Prisma.Sql]) => ({
      sql: sql.sql.replace(/\s+/g, ' '),
      values: sql.values,
    }));
  }

  beforeEach(() => {
    // HU-022 (BL-496): la propina va aparte de las ventas (monto = consumo).
    porCanal = [
      {
        canal: 'QR',
        monto: decimal(1000),
        pedidos: 2,
        propina: decimal(100),
        pedidos_con_propina: 2,
      },
      {
        canal: 'MOZO',
        monto: decimal(500.5),
        pedidos: 1,
        propina: decimal(50.5),
        pedidos_con_propina: 1,
      },
      {
        canal: 'WEB',
        monto: decimal(800),
        pedidos: 1,
        propina: decimal(0),
        pedidos_con_propina: 0,
      },
    ];
    porCanalAnterior = [{ canal: 'QR', monto: decimal(900), pedidos: 3 }];
    porHora = [
      { hora: 12, monto: decimal(1300), pedidos: 3, propina: decimal(100) },
      { hora: 21, monto: decimal(1000.5), pedidos: 1, propina: decimal(50.5) },
    ];
    platos = [
      {
        item_carta_id: 'a',
        nombre: 'Agua',
        cantidad: 9,
        recaudado: decimal(900),
      },
      {
        item_carta_id: 'b',
        nombre: 'Bife',
        cantidad: 2,
        recaudado: decimal(1200),
      },
      {
        item_carta_id: 'c',
        nombre: 'Chivito',
        cantidad: 4,
        recaudado: decimal(1000),
      },
    ];
    rotacion = [{ sesiones: 25, minutos: decimal(47.6) }];

    tx = {
      $queryRaw: jest.fn((sql: Prisma.Sql) => {
        const texto = sql.sql;
        if (texto.includes('FROM sesion_mesa'))
          return Promise.resolve(rotacion);
        if (texto.includes('FROM resumen_platos_hora'))
          return Promise.resolve(platos);
        if (texto.includes('EXTRACT(HOUR')) return Promise.resolve(porHora);
        // ventasPorCanal: primero el período, después el anterior.
        const primera = !tx.$queryRaw.mock.calls
          .slice(0, -1)
          .some(([s]: [Prisma.Sql]) => s.sql.includes('GROUP BY canal'));
        return Promise.resolve(primera ? porCanal : porCanalAnterior);
      }),
      restaurante: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ timezone: 'America/Montevideo' }),
      },
      mesa: { count: jest.fn().mockResolvedValue(10) },
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_tenantId: string, fn: any) => fn(tx)),
    };
    service = new ReportesService(tenantPrisma as any);
  });

  it('[TC-U-297] con todos los canales: totales, ticket promedio, período anterior y ventas dentro y fuera del local', async () => {
    const reporte = await service.obtener(TENANT_ID, filtros(), AHORA);

    expect(tenantPrisma.runInTenantContext).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Function),
    );
    expect(reporte.rango).toEqual({
      desde: '2026-11-02',
      hasta: '2026-11-02',
      timezone: 'America/Montevideo',
    });
    expect(reporte.resumen).toEqual({
      totalVendido: 2300.5,
      pedidos: 4,
      ticketPromedio: 575.13,
      anterior: { totalVendido: 900, pedidos: 3 },
      propinas: { total: 150.5, pedidosConPropina: 3, porcentajeDeVentas: 6.5 },
    });
    expect(reporte.porLugar).toEqual({
      local: 1500.5,
      web: 800,
      whatsapp: 0,
      pos: 0,
    });
    expect(reporte.ventasPorHora).toEqual([
      { hora: 12, monto: 1300, pedidos: 3, propina: 100 },
      { hora: 21, monto: 1000.5, pedidos: 1, propina: 50.5 },
    ]);
  });

  it('[TC-U-298] el período anterior se consulta con los días justo antes (hoy contra ayer)', async () => {
    await service.obtener(TENANT_ID, filtros(), AHORA);

    const [actual, anterior] = consultas().filter((c) =>
      c.sql.includes('GROUP BY canal'),
    );
    expect(actual.values).toEqual(expect.arrayContaining(['2026-11-02']));
    expect(anterior.values).toEqual(expect.arrayContaining(['2026-11-01']));
    expect(anterior.values).not.toContain('2026-11-02');
  });

  it('[TC-U-299] En el local: solo QR y mozo en totales, horas y platos; dentro y fuera del local sigue completo', async () => {
    const reporte = await service.obtener(
      TENANT_ID,
      filtros({ canal: 'LOCAL' }),
      AHORA,
    );

    expect(reporte.resumen.totalVendido).toBe(1500.5);
    expect(reporte.resumen.pedidos).toBe(3);
    expect(reporte.porLugar.web).toBe(800);
    const filtradas = consultas().filter(
      (c) =>
        c.sql.includes('EXTRACT(HOUR') || c.sql.includes('resumen_platos_hora'),
    );
    expect(filtradas).toHaveLength(2);
    for (const c of filtradas) {
      expect(c.sql).toContain('canal::text IN');
      expect(c.values).toEqual(expect.arrayContaining(['QR', 'MOZO']));
      expect(c.values).not.toContain('WEB');
    }
  });

  it('[TC-U-300] con todos los canales, horas y platos no filtran por canal', async () => {
    await service.obtener(TENANT_ID, filtros(), AHORA);

    for (const c of consultas()) {
      expect(c.sql).not.toContain('canal::text IN');
    }
  });

  it('[TC-U-301] platos: el top por cantidad y el top por recaudado', async () => {
    const reporte = await service.obtener(TENANT_ID, filtros(), AHORA);

    expect(reporte.platosMasPedidos.porCantidad.map((p) => p.nombre)).toEqual([
      'Agua',
      'Chivito',
      'Bife',
    ]);
    expect(reporte.platosMasPedidos.porRecaudado.map((p) => p.nombre)).toEqual([
      'Bife',
      'Chivito',
      'Agua',
    ]);
    expect(reporte.platosMasPedidos.porCantidad[0]).toEqual({
      itemCartaId: 'a',
      nombre: 'Agua',
      cantidad: 9,
      recaudado: 900,
    });
  });

  it('[TC-U-302] el ranking muestra hasta 10 platos', async () => {
    platos = Array.from({ length: 12 }, (_, i) => ({
      item_carta_id: `p${i}`,
      nombre: `Plato ${i}`,
      cantidad: i + 1,
      recaudado: decimal(100 * (i + 1)),
    }));

    const reporte = await service.obtener(TENANT_ID, filtros(), AHORA);

    expect(reporte.platosMasPedidos.porCantidad).toHaveLength(10);
    expect(reporte.platosMasPedidos.porCantidad[0].nombre).toBe('Plato 11');
  });

  it('[TC-U-303] rotación: turnos por mesa física y ocupación promedio en minutos', async () => {
    const reporte = await service.obtener(TENANT_ID, filtros(), AHORA);

    expect(reporte.rotacionMesas).toEqual({
      aplica: true,
      sesiones: 25,
      mesas: 10,
      rotacion: 2.5,
      ocupacionPromedioMin: 48,
    });
    expect(tx.mesa.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, esVirtual: false },
    });
  });

  it.each(['WEB', 'WHATSAPP', 'POS'] as const)(
    '[TC-U-304] con %s la rotación no aplica y no se consulta',
    async (canal) => {
      const reporte = await service.obtener(
        TENANT_ID,
        filtros({ canal }),
        AHORA,
      );

      expect(reporte.rotacionMesas).toEqual({ aplica: false });
      expect(consultas().some((c) => c.sql.includes('sesion_mesa'))).toBe(
        false,
      );
      expect(tx.mesa.count).not.toHaveBeenCalled();
    },
  );

  it('[TC-U-464] HU-011 (BL-489): canal POS del local en totales y en dentro y fuera del local', async () => {
    porCanal.push({ canal: 'POS', monto: decimal(350), pedidos: 2 });

    const todos = await service.obtener(TENANT_ID, filtros(), AHORA);
    expect(todos.resumen.totalVendido).toBe(2650.5);
    expect(todos.porLugar.pos).toBe(350);

    tx.$queryRaw.mockClear();
    const pos = await service.obtener(
      TENANT_ID,
      filtros({ canal: 'POS' }),
      AHORA,
    );
    expect(pos.resumen).toMatchObject({ totalVendido: 350, pedidos: 2 });
    const filtradas = consultas().filter(
      (c) =>
        c.sql.includes('canal::text IN') &&
        c.values.includes('POS') &&
        !c.values.includes('QR'),
    );
    expect(filtradas).toHaveLength(2);
  });

  it('[TC-U-305] sin ventas: todo en cero, sin dividir por cero', async () => {
    porCanal = [];
    porCanalAnterior = [];
    porHora = [];
    platos = [];
    rotacion = [{ sesiones: 0, minutos: null }];
    tx.mesa.count.mockResolvedValue(0);

    const reporte = await service.obtener(TENANT_ID, filtros(), AHORA);

    expect(reporte.resumen).toEqual({
      totalVendido: 0,
      pedidos: 0,
      ticketPromedio: 0,
      anterior: { totalVendido: 0, pedidos: 0 },
      propinas: { total: 0, pedidosConPropina: 0, porcentajeDeVentas: 0 },
    });
    expect(reporte.rotacionMesas).toEqual({
      aplica: true,
      sesiones: 0,
      mesas: 0,
      rotacion: 0,
      ocupacionPromedioMin: 0,
    });
  });

  it('[TC-U-306] BL-110: el tenant, la zona y las fechas van como parámetros; ventas y platos salen solo del resumen', async () => {
    await service.obtener(TENANT_ID, filtros(), AHORA);

    for (const c of consultas()) {
      expect(c.sql).not.toContain(TENANT_ID);
      expect(c.sql).not.toContain('America/Montevideo');
      expect(c.sql).not.toContain('2026-11-02');
      expect(c.values).toContain(TENANT_ID);
      expect(c.sql).not.toMatch(/FROM (pago|linea_pedido|pedido)\b/);
    }
  });

  it('[TC-U-307] sin establecimiento => 404', async () => {
    tx.restaurante.findFirst.mockResolvedValue(null);

    await expect(service.obtener(TENANT_ID, filtros(), AHORA)).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('HU-022 (BL-496): propinas', () => {
    it('las propinas salen de la columna propina del resumen y no se suman a las ventas', async () => {
      await service.obtener(TENANT_ID, filtros(), AHORA);

      const delResumen = consultas().filter((c) =>
        c.sql.includes('FROM resumen_ventas_hora'),
      );
      // Por canal (período y anterior) y por hora.
      expect(delResumen).toHaveLength(3);
      for (const c of delResumen) {
        expect(c.sql).toContain('SUM(propina) AS propina');
        expect(c.sql).not.toContain('monto + propina');
      }
      const porCanalSql = delResumen.filter((c) =>
        c.sql.includes('GROUP BY canal'),
      );
      for (const c of porCanalSql) {
        expect(c.sql).toContain(
          'SUM(pedidos_con_propina)::int AS pedidos_con_propina',
        );
      }
    });

    it('con el filtro En el local, las propinas y el porcentaje son solo de QR y mozo', async () => {
      const reporte = await service.obtener(
        TENANT_ID,
        filtros({ canal: 'LOCAL' }),
        AHORA,
      );

      expect(reporte.resumen.propinas).toEqual({
        total: 150.5,
        pedidosConPropina: 3,
        porcentajeDeVentas: 10,
      });
    });

    it('si no hay ventas pero sí propina, el porcentaje queda en cero (sin dividir por cero)', async () => {
      porCanal = [
        {
          canal: 'QR',
          monto: decimal(0),
          pedidos: 0,
          propina: decimal(10),
          pedidos_con_propina: 1,
        },
      ];

      const reporte = await service.obtener(TENANT_ID, filtros(), AHORA);

      expect(reporte.resumen.propinas).toEqual({
        total: 10,
        pedidosConPropina: 1,
        porcentajeDeVentas: 0,
      });
    });
  });
});
