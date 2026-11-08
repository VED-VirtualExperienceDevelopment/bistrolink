import {
  HORA_MS,
  ResumenVentasService,
  truncarHora,
  ventanaReciente,
} from '../../src/reportes/resumen-ventas.service';

// HU-012 (BL-219): resumen de ventas por hora para el dashboard. Las
// consultas contra la base se prueban en la integración
// (reportes.e2e-spec); acá, el orden, la ventana y los parámetros.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

describe('ventanas de horas del resumen de ventas', () => {
  it('[TC-U-275] truncarHora va al comienzo de la hora en UTC y ventanaReciente incluye la hora en curso completa', () => {
    const ahora = new Date('2026-11-02T15:42:10.500Z');

    expect(truncarHora(ahora).toISOString()).toBe('2026-11-02T15:00:00.000Z');
    expect(ventanaReciente(ahora, 2)).toEqual({
      desde: new Date('2026-11-02T14:00:00.000Z'),
      hasta: new Date('2026-11-02T16:00:00.000Z'),
    });
    const { desde, hasta } = ventanaReciente(ahora, 48);
    expect(hasta.getTime() - desde.getTime()).toBe(48 * HORA_MS);
  });
});

describe('ResumenVentasService', () => {
  let tx: { $executeRaw: jest.Mock };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let service: ResumenVentasService;

  /** El SQL (sin parámetros) y los parámetros de la llamada n. */
  function consulta(n: number): { sql: string; values: unknown[] } {
    const [sql] = tx.$executeRaw.mock.calls[n];
    return { sql: sql.sql.replace(/\s+/g, ' '), values: sql.values };
  }

  beforeEach(() => {
    // Lo que devuelve cada llamada: candado, borrar, insertar ventas,
    // borrar, insertar platos.
    tx = {
      $executeRaw: jest
        .fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(9)
        .mockResolvedValueOnce(7),
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_tenantId: string, fn: any) => fn(tx)),
    };
    service = new ResumenVentasService(tenantPrisma as any);
  });

  it('[TC-U-276] recalcularVentana: en el contexto del tenant, con candado, borra y vuelve a calcular las dos tablas', async () => {
    await service.recalcularVentana(TENANT_ID, {
      desde: new Date('2026-11-01T10:30:00.000Z'),
      hasta: new Date('2026-11-01T13:00:00.000Z'),
    });

    expect(tenantPrisma.runInTenantContext).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Function),
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(5);
    expect(consulta(0).sql).toContain('pg_advisory_xact_lock');
    expect(consulta(0).values).toEqual([`resumen_ventas:${TENANT_ID}`]);
    expect(consulta(1).sql).toContain('DELETE FROM resumen_ventas_hora');
    expect(consulta(2).sql).toContain('INSERT INTO resumen_ventas_hora');
    expect(consulta(2).sql).toContain("pg.estado = 'APROBADO'");
    expect(consulta(3).sql).toContain('DELETE FROM resumen_platos_hora');
    expect(consulta(4).sql).toContain('INSERT INTO resumen_platos_hora');
    expect(consulta(4).sql).toContain("estado = 'APROBADO'");
  });

  it('[TC-U-277] recalcularVentana: el tenant y la ventana (truncada a horas) van como parámetros, nunca en el texto', async () => {
    await service.recalcularVentana(TENANT_ID, {
      desde: new Date('2026-11-01T10:30:00.000Z'),
      hasta: new Date('2026-11-01T13:00:00.000Z'),
    });

    for (let n = 1; n <= 4; n++) {
      const { sql, values } = consulta(n);
      expect(sql).not.toContain(TENANT_ID);
      expect(values).toEqual(
        expect.arrayContaining([
          TENANT_ID,
          '2026-11-01T10:00:00.000Z',
          '2026-11-01T13:00:00.000Z',
        ]),
      );
    }
  });

  it('[TC-U-278] recalcularVentana devuelve las filas que quedaron en cada tabla', async () => {
    const resultado = await service.recalcularVentana(TENANT_ID, {
      desde: new Date('2026-11-01T10:00:00.000Z'),
      hasta: new Date('2026-11-01T11:00:00.000Z'),
    });

    expect(resultado).toEqual({ ventas: 3, platos: 7 });
  });

  it('[TC-U-279] recalcularRecientes: la hora en curso y la anterior (el pago se reserva antes de aprobarse)', async () => {
    const espia = jest.spyOn(service, 'recalcularVentana');

    await service.recalcularRecientes(
      TENANT_ID,
      new Date('2026-11-02T15:05:00.000Z'),
    );

    expect(espia).toHaveBeenCalledWith(TENANT_ID, {
      desde: new Date('2026-11-02T14:00:00.000Z'),
      hasta: new Date('2026-11-02T16:00:00.000Z'),
    });
  });
});
