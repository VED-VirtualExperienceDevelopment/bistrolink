import { ReglasComplementoService } from '../../src/complementos/reglas-complemento.service';

/** HU-046 (BL-552): recálculo de las reglas de un local. */

const TENANT = '11111111-1111-1111-1111-111111111111';
const AHORA = new Date('2026-11-15T07:00:00.000Z');

describe('ReglasComplementoService', () => {
  let tx: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    reglaComplemento: { deleteMany: jest.Mock; createMany: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let servicio: ReglasComplementoService;

  /** Respuestas de las tres consultas: por plato, total y pares. */
  function conConteos(
    porPlato: { item_carta_id: string; pedidos: number }[],
    pedidos: number,
    pares: {
      antecedente_id: string;
      consecuente_id: string;
      pedidos_con_ambos: number;
    }[],
  ) {
    tx.$queryRaw
      .mockResolvedValueOnce(porPlato)
      .mockResolvedValueOnce([{ pedidos }])
      .mockResolvedValueOnce(pares);
  }

  const sqlDe = (llamada: number) => {
    const consulta = tx.$queryRaw.mock.calls[llamada][0] as {
      sql: string;
      values: unknown[];
    };
    return consulta;
  };

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn(),
      reglaComplemento: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_tenant, fn) => fn(tx)),
    };
    servicio = new ReglasComplementoService(tenantPrisma as any);
  });

  it('borra las reglas del local y guarda las que cumplen, con candado por tenant', async () => {
    conConteos(
      [
        { item_carta_id: 'milanesa', pedidos: 20 },
        { item_carta_id: 'flan', pedidos: 10 },
        { item_carta_id: 'agua', pedidos: 50 },
      ],
      100,
      [
        {
          antecedente_id: 'milanesa',
          consecuente_id: 'flan',
          pedidos_con_ambos: 8,
        },
        // Lift < 1: el agua se pide igual.
        {
          antecedente_id: 'milanesa',
          consecuente_id: 'agua',
          pedidos_con_ambos: 6,
        },
      ],
    );

    await expect(servicio.recalcular(TENANT, AHORA)).resolves.toEqual({
      pedidos: 100,
      reglas: 1,
    });

    expect(tenantPrisma.runInTenantContext).toHaveBeenCalledWith(
      TENANT,
      expect.any(Function),
      { timeout: 60_000 },
    );
    const candado = tx.$executeRaw.mock.calls[0][0];
    expect(candado.sql).toContain('pg_advisory_xact_lock');
    expect(candado.values).toEqual([`reglas_complemento:${TENANT}`]);
    expect(tx.reglaComplemento.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT },
    });
    expect(tx.reglaComplemento.createMany).toHaveBeenCalledWith({
      data: [
        {
          tenantId: TENANT,
          antecedenteId: 'milanesa',
          consecuenteId: 'flan',
          pedidosConAmbos: 8,
          soporte: 0.08,
          confianza: 0.4,
          lift: 4,
          calculadaEn: AHORA,
        },
      ],
    });
  });

  it('sin reglas que cumplan, borra las anteriores y no inserta', async () => {
    conConteos([], 0, []);
    await expect(servicio.recalcular(TENANT, AHORA)).resolves.toEqual({
      pedidos: 0,
      reglas: 0,
    });
    expect(tx.reglaComplemento.deleteMany).toHaveBeenCalled();
    expect(tx.reglaComplemento.createMany).not.toHaveBeenCalled();
  });

  it('cuenta con parámetros: pagos aprobados de 90 días, consecuente sugerible y sin alcohol, al menos 5 pedidos', async () => {
    conConteos([], 0, []);
    await servicio.recalcular(TENANT, AHORA);

    const pares = sqlDe(2);
    expect(pares.sql).toContain("pg.estado = 'APROBADO'");
    expect(pares.sql).toContain('ic.sugerible');
    expect(pares.sql).toContain('NOT ic.contiene_alcohol');
    expect(pares.sql).toContain('ic.archivado_en IS NULL');
    expect(pares.sql).toContain('b.item_carta_id <> a.item_carta_id');
    expect(pares.values).toContain(TENANT);
    expect(pares.values).toContain(5);
    expect(pares.values).toContainEqual(new Date('2026-08-17T07:00:00.000Z'));
    expect(pares.values).toContainEqual(AHORA);
    // Nada concatenado: el tenant va como parámetro.
    for (const llamada of [0, 1, 2]) {
      expect(sqlDe(llamada).sql).not.toContain(TENANT);
    }
  });

  it('sin fecha, la ventana termina ahora', async () => {
    conConteos([], 0, []);
    const antes = Date.now();
    await servicio.recalcular(TENANT);
    const hasta = sqlDe(0).values.find(
      (v) => v instanceof Date && v.getTime() >= antes,
    );
    expect(hasta).toBeDefined();
  });
});
