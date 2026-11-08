import { Logger } from '@nestjs/common';
import { ConciliacionPagosJob } from '../../src/pagos/conciliacion/conciliacion-pagos.job';
import { configuracionConciliacion } from '../../src/pagos/conciliacion/configuracion-conciliacion';

// HU-032 (BL-202): job periódico de conciliación de pagos pendientes.

const RESUMEN = { revisados: 2, conciliados: 1, vencidos: 1, errores: 0 };

describe('configuracionConciliacion', () => {
  it('por defecto: habilitada, cada 60 s, consulta a los 2 min y vence a los 15', () => {
    expect(configuracionConciliacion({ NODE_ENV: 'production' })).toEqual({
      habilitada: true,
      intervaloMs: 60_000,
      conciliarDespuesMs: 120_000,
      vencerDespuesMs: 900_000,
      lote: 50,
    });
  });

  it('se puede apagar con PAGOS_CONCILIACION_HABILITADA=false', () => {
    expect(
      configuracionConciliacion({ PAGOS_CONCILIACION_HABILITADA: 'false' })
        .habilitada,
    ).toBe(false);
  });

  it('en los tests está apagada, salvo que se habilite a propósito', () => {
    expect(configuracionConciliacion({ NODE_ENV: 'test' }).habilitada).toBe(
      false,
    );
    expect(
      configuracionConciliacion({
        NODE_ENV: 'test',
        PAGOS_CONCILIACION_HABILITADA: 'TRUE',
      }).habilitada,
    ).toBe(true);
  });

  it('toma los valores de las variables', () => {
    expect(
      configuracionConciliacion({
        PAGOS_CONCILIACION_INTERVALO_SEG: '30',
        PAGOS_CONCILIAR_DESPUES_MIN: '5',
        PAGOS_VENCER_DESPUES_MIN: '20',
        PAGOS_CONCILIACION_LOTE: '10',
      }),
    ).toMatchObject({
      intervaloMs: 30_000,
      conciliarDespuesMs: 300_000,
      vencerDespuesMs: 1_200_000,
      lote: 10,
    });
  });

  it('valores inválidos (texto, cero, negativos, decimales) => los de por defecto', () => {
    expect(
      configuracionConciliacion({
        PAGOS_CONCILIACION_INTERVALO_SEG: 'abc',
        PAGOS_CONCILIAR_DESPUES_MIN: '0',
        PAGOS_VENCER_DESPUES_MIN: '-3',
        PAGOS_CONCILIACION_LOTE: '2.5',
      }),
    ).toMatchObject({
      intervaloMs: 60_000,
      conciliarDespuesMs: 120_000,
      vencerDespuesMs: 900_000,
      lote: 50,
    });
  });

  it('nunca vence antes de consultar a la pasarela', () => {
    expect(
      configuracionConciliacion({
        PAGOS_CONCILIAR_DESPUES_MIN: '10',
        PAGOS_VENCER_DESPUES_MIN: '3',
      }).vencerDespuesMs,
    ).toBe(600_000);
  });
});

describe('ConciliacionPagosJob', () => {
  const entornoOriginal = process.env;
  let moduleRef: { resolve: jest.Mock };
  let servicio: { conciliarTenant: jest.Mock };
  let prisma: { tenant: { findMany: jest.Mock } };

  function crearJob(env: NodeJS.ProcessEnv = {}): ConciliacionPagosJob {
    process.env = { ...entornoOriginal, NODE_ENV: 'production', ...env };
    return new ConciliacionPagosJob(moduleRef as any, prisma as any);
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    servicio = { conciliarTenant: jest.fn().mockResolvedValue(RESUMEN) };
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

  it('recorre todos los establecimientos y suma los resultados', async () => {
    const job = crearJob();
    const ahora = new Date('2026-10-26T12:00:00.000Z');

    const total = await job.ejecutar(ahora);

    expect(servicio.conciliarTenant).toHaveBeenCalledTimes(2);
    expect(servicio.conciliarTenant).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ vencerDespuesMs: 900_000 }),
      ahora,
    );
    expect(total).toEqual({
      revisados: 4,
      conciliados: 2,
      vencidos: 2,
      errores: 0,
    });
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('2 vencidos'),
      }),
    );
  });

  it('resuelve el servicio (por request) una sola vez y lo reutiliza', async () => {
    const job = crearJob();

    await job.ejecutar();
    await job.ejecutar();

    expect(moduleRef.resolve).toHaveBeenCalledTimes(1);
  });

  it('un establecimiento que falla no frena a los demás', async () => {
    servicio.conciliarTenant
      .mockRejectedValueOnce(new Error('base caída'))
      .mockResolvedValueOnce(RESUMEN);
    const job = crearJob();

    const total = await job.ejecutar();

    expect(servicio.conciliarTenant).toHaveBeenCalledTimes(2);
    expect(total).toMatchObject({ revisados: 2, errores: 1 });
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('nunca lanza: si no puede listar los establecimientos, lo deja en el log', async () => {
    prisma.tenant.findMany.mockRejectedValue(new Error('sin conexión'));
    const job = crearJob();

    await expect(job.ejecutar()).resolves.toEqual({
      revisados: 0,
      conciliados: 0,
      vencidos: 0,
      errores: 0,
    });
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('sin novedades no escribe nada en el log', async () => {
    servicio.conciliarTenant.mockResolvedValue({
      revisados: 0,
      conciliados: 0,
      vencidos: 0,
      errores: 0,
    });
    const job = crearJob();

    await job.ejecutar();

    expect(Logger.prototype.log).not.toHaveBeenCalled();
  });

  it('si una corrida sigue en curso, la siguiente se saltea', async () => {
    let terminar!: () => void;
    servicio.conciliarTenant.mockReturnValue(
      new Promise((resolve) => {
        terminar = () => resolve(RESUMEN);
      }),
    );
    prisma.tenant.findMany.mockResolvedValue([{ id: 't1' }]);
    const job = crearJob();

    const primera = job.ejecutar();
    await Promise.resolve();
    await expect(job.ejecutar()).resolves.toBeNull();
    // Hay que esperar a que la primera llegue al servicio para terminarla.
    while (!terminar) await Promise.resolve();
    terminar();
    await expect(primera).resolves.toMatchObject({ revisados: 2 });
  });

  it('habilitado: corre cada intervalo y se apaga al cerrar el módulo', async () => {
    jest.useFakeTimers();
    const job = crearJob({ PAGOS_CONCILIACION_INTERVALO_SEG: '30' });
    const ejecutar = jest.spyOn(job, 'ejecutar').mockResolvedValue(null);

    job.onApplicationBootstrap();
    jest.advanceTimersByTime(30_000);
    expect(ejecutar).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(30_000);
    expect(ejecutar).toHaveBeenCalledTimes(2);

    job.onModuleDestroy();
    jest.advanceTimersByTime(60_000);
    expect(ejecutar).toHaveBeenCalledTimes(2);
  });

  it('deshabilitado: no programa nada', () => {
    jest.useFakeTimers();
    const job = crearJob({ PAGOS_CONCILIACION_HABILITADA: 'false' });
    const ejecutar = jest.spyOn(job, 'ejecutar').mockResolvedValue(null);

    job.onApplicationBootstrap();
    jest.advanceTimersByTime(600_000);

    expect(ejecutar).not.toHaveBeenCalled();
  });
});
