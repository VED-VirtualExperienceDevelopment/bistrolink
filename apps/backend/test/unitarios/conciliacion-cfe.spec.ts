import { Logger } from '@nestjs/common';
import { configuracionConciliacionCfe } from '../../src/cfe/conciliacion-cfe/configuracion-conciliacion-cfe';
import {
  ESPERA_INICIAL_MS,
  esperaDespuesDe,
  proximoIntento,
  requiereAtencion,
  tocaReintentar,
} from '../../src/cfe/conciliacion-cfe/reintentos-cfe';
import { ConciliacionCfeService } from '../../src/cfe/conciliacion-cfe/conciliacion-cfe.service';
import { ConciliacionCfeJob } from '../../src/cfe/conciliacion-cfe/conciliacion-cfe.job';

// HU-023 (BL-96): conciliación de CFE pendientes (pagos aprobados sin CFE).

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const AHORA = new Date('2026-11-03T15:00:00.000Z');
const MIN = 60_000;
const LIMITES = { dias: 3, maxIntentos: 10 };
const hace = (ms: number) => new Date(AHORA.getTime() - ms);

describe('configuracionConciliacionCfe', () => {
  it('por defecto: habilitada, cada 5 min, 3 días, 10 intentos, lote de 20', () => {
    expect(configuracionConciliacionCfe({ NODE_ENV: 'production' })).toEqual({
      habilitada: true,
      intervaloMs: 5 * MIN,
      dias: 3,
      maxIntentos: 10,
      lote: 20,
    });
  });

  it('apagada en los tests salvo que se habilite; valores de las variables', () => {
    expect(configuracionConciliacionCfe({ NODE_ENV: 'test' }).habilitada).toBe(
      false,
    );
    expect(
      configuracionConciliacionCfe({
        NODE_ENV: 'test',
        CFE_CONCILIACION_HABILITADA: 'true',
        CFE_CONCILIACION_INTERVALO_MIN: '2',
        CFE_CONCILIACION_DIAS: '7',
        CFE_CONCILIACION_MAX_INTENTOS: '4',
        CFE_CONCILIACION_LOTE: 'x',
      }),
    ).toEqual({
      habilitada: true,
      intervaloMs: 2 * MIN,
      dias: 7,
      maxIntentos: 4,
      lote: 20,
    });
    expect(
      configuracionConciliacionCfe({ CFE_CONCILIACION_HABILITADA: 'false' })
        .habilitada,
    ).toBe(false);
  });
});

describe('reintentos-cfe (cuándo se reintenta)', () => {
  it.each([
    [0, 0],
    [1, 5 * MIN],
    [2, 15 * MIN],
    [3, 60 * MIN],
    [4, 360 * MIN],
    [9, 360 * MIN],
  ])('después de %i intentos fallidos espera %i ms', (intentos, espera) => {
    expect(esperaDespuesDe(intentos)).toBe(espera);
  });

  it('un pago recién aprobado espera la emisión en segundo plano', () => {
    const recien = {
      createdAt: hace(60_000),
      cfeIntentos: 0,
      cfeUltimoIntentoEn: null,
    };
    expect(tocaReintentar(recien, LIMITES, AHORA)).toBe(false);
    expect(proximoIntento(recien, LIMITES, AHORA)).toEqual(
      new Date(recien.createdAt.getTime() + ESPERA_INICIAL_MS),
    );
    expect(
      tocaReintentar({ ...recien, createdAt: hace(3 * MIN) }, LIMITES, AHORA),
    ).toBe(true);
  });

  it('con intentos fallidos, espera según cuántos fueron', () => {
    const pago = {
      createdAt: hace(60 * MIN),
      cfeIntentos: 2,
      cfeUltimoIntentoEn: hace(10 * MIN),
    };
    expect(tocaReintentar(pago, LIMITES, AHORA)).toBe(false); // espera 15
    expect(
      tocaReintentar(
        { ...pago, cfeUltimoIntentoEn: hace(16 * MIN) },
        LIMITES,
        AHORA,
      ),
    ).toBe(true);
  });

  it('requiere atención con el máximo de intentos o pasados los días', () => {
    const base = {
      createdAt: hace(MIN * 10),
      cfeIntentos: 0,
      cfeUltimoIntentoEn: null,
    };
    expect(requiereAtencion(base, LIMITES, AHORA)).toBe(false);
    expect(requiereAtencion({ ...base, cfeIntentos: 10 }, LIMITES, AHORA)).toBe(
      true,
    );
    expect(
      requiereAtencion(
        { ...base, createdAt: hace(3 * 24 * 60 * MIN + MIN) },
        LIMITES,
        AHORA,
      ),
    ).toBe(true);
    expect(
      proximoIntento({ ...base, cfeIntentos: 10 }, LIMITES, AHORA),
    ).toBeNull();
  });
});

describe('ConciliacionCfeService.conciliarTenant', () => {
  let tx: { pago: { findMany: jest.Mock } };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let cfe: { configurado: jest.Mock; reintentar: jest.Mock };
  let service: ConciliacionCfeService;
  const CONFIG = { dias: 3, maxIntentos: 10, lote: 2 };

  const pago = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    createdAt: hace(30 * MIN),
    cfeIntentos: 0,
    cfeUltimoIntentoEn: null,
    ...extra,
  });

  beforeEach(() => {
    tx = { pago: { findMany: jest.fn().mockResolvedValue([pago('p1')]) } };
    tenantPrisma = {
      runInTenantContext: jest.fn((_t, callback) => callback(tx)),
    };
    cfe = {
      configurado: jest.fn().mockReturnValue(true),
      reintentar: jest
        .fn()
        .mockResolvedValue({ comprobante: { serie: 'A' }, error: null }),
    };
    service = new ConciliacionCfeService(tenantPrisma as any, cfe as any);
  });

  it('busca los APROBADOS sin CFE de los últimos días, con menos del máximo de intentos, dentro del tenant', async () => {
    await service.conciliarTenant(TENANT_ID, CONFIG, AHORA);

    expect(tenantPrisma.runInTenantContext).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Function),
    );
    expect(tx.pago.findMany.mock.calls[0][0].where).toEqual({
      estado: 'APROBADO',
      comprobantes: { none: {} },
      cfeIntentos: { lt: 10 },
      createdAt: {
        gte: hace(3 * 24 * 60 * MIN),
        lte: hace(ESPERA_INICIAL_MS),
      },
    });
  });

  it('reintenta los que les toca, de a uno y hasta el lote, y cuenta emitidos y fallidos', async () => {
    tx.pago.findMany.mockResolvedValue([
      pago('p1'),
      pago('p2', { cfeIntentos: 1, cfeUltimoIntentoEn: hace(2 * MIN) }), // no le toca
      pago('p3'),
      pago('p4'), // fuera del lote
    ]);
    cfe.reintentar
      .mockResolvedValueOnce({ comprobante: { serie: 'A' }, error: null })
      .mockResolvedValueOnce({ comprobante: null, error: 'HTTP 503' });

    const resumen = await service.conciliarTenant(TENANT_ID, CONFIG, AHORA);

    expect(cfe.reintentar.mock.calls.map((c) => c[1])).toEqual(['p1', 'p3']);
    expect(resumen).toEqual({ revisados: 2, emitidos: 1, fallidos: 1 });
  });

  it('sin Surtec configurado no busca ni reintenta', async () => {
    cfe.configurado.mockReturnValue(false);

    await expect(
      service.conciliarTenant(TENANT_ID, CONFIG, AHORA),
    ).resolves.toEqual({ revisados: 0, emitidos: 0, fallidos: 0 });
    expect(tx.pago.findMany).not.toHaveBeenCalled();
  });
});

describe('ConciliacionCfeJob', () => {
  const entornoOriginal = process.env;
  let moduleRef: { resolve: jest.Mock };
  let servicio: { conciliarTenant: jest.Mock };
  let prisma: { tenant: { findMany: jest.Mock } };

  function crearJob(env: NodeJS.ProcessEnv = {}): ConciliacionCfeJob {
    process.env = { ...entornoOriginal, NODE_ENV: 'production', ...env };
    return new ConciliacionCfeJob(moduleRef as any, prisma as any);
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    servicio = {
      conciliarTenant: jest
        .fn()
        .mockResolvedValue({ revisados: 2, emitidos: 1, fallidos: 1 }),
    };
    moduleRef = { resolve: jest.fn().mockResolvedValue(servicio) };
    prisma = {
      tenant: {
        findMany: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]),
      },
    };
  });

  afterEach(() => {
    process.env = entornoOriginal;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('recorre todos los establecimientos con la configuración y suma', async () => {
    const total = await crearJob({ CFE_CONCILIACION_DIAS: '5' }).ejecutar(
      AHORA,
    );

    expect(servicio.conciliarTenant).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ dias: 5, maxIntentos: 10, lote: 20 }),
      AHORA,
    );
    expect(total).toEqual({ revisados: 4, emitidos: 2, fallidos: 2 });
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('4 reintentados, 2 emitidos'),
      }),
    );
  });

  it('un establecimiento que falla no frena a los demás; nunca lanza', async () => {
    servicio.conciliarTenant.mockRejectedValueOnce(new Error('base caída'));

    await expect(crearJob().ejecutar()).resolves.toMatchObject({
      revisados: 2,
    });
    expect(Logger.prototype.error).toHaveBeenCalled();

    prisma.tenant.findMany.mockRejectedValue(new Error('sin conexión'));
    await expect(crearJob().ejecutar()).resolves.toEqual({
      revisados: 0,
      emitidos: 0,
      fallidos: 0,
    });
  });

  it('sin novedades no escribe en el log; arranca el timer solo si está habilitada', async () => {
    servicio.conciliarTenant.mockResolvedValue({
      revisados: 0,
      emitidos: 0,
      fallidos: 0,
    });
    await crearJob().ejecutar();
    expect(Logger.prototype.log).not.toHaveBeenCalled();

    jest.useFakeTimers();
    const job = crearJob();
    const ejecutar = jest.spyOn(job, 'ejecutar').mockResolvedValue(null);
    job.onApplicationBootstrap();
    jest.advanceTimersByTime(5 * MIN);
    expect(ejecutar).toHaveBeenCalledTimes(1);
    job.onModuleDestroy();

    const apagado = crearJob({ CFE_CONCILIACION_HABILITADA: 'false' });
    const ejecutarApagado = jest
      .spyOn(apagado, 'ejecutar')
      .mockResolvedValue(null);
    apagado.onApplicationBootstrap();
    jest.advanceTimersByTime(5 * MIN);
    expect(ejecutarApagado).not.toHaveBeenCalled();
  });

  it('si una corrida sigue en curso, la siguiente se saltea', async () => {
    let terminar!: () => void;
    servicio.conciliarTenant.mockReturnValue(
      new Promise((resolve) => {
        terminar = () => resolve({ revisados: 1, emitidos: 1, fallidos: 0 });
      }),
    );
    prisma.tenant.findMany.mockResolvedValue([{ id: 't1' }]);
    const job = crearJob();

    const primera = job.ejecutar();
    await Promise.resolve();
    await expect(job.ejecutar()).resolves.toBeNull();
    while (!terminar) await Promise.resolve();
    terminar();
    await expect(primera).resolves.toMatchObject({ emitidos: 1 });
  });
});
