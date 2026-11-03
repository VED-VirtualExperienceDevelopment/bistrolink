=import { Logger } from '@nestjs/common';
import { ResumenVentasJob } from '../../src/reportes/resumen-ventas.job';
import { configuracionResumenVentas } from '../../src/reportes/configuracion-resumen-ventas';

// HU-012 (BL-219): job periódico que mantiene el resumen de ventas.

describe('configuracionResumenVentas', () => {
  it('[TC-U-280] por defecto: habilitado, cada 15 min, últimas 48 h; en los tests apagado salvo a propósito', () => {
    expect(configuracionResumenVentas({ NODE_ENV: 'production' })).toEqual({
      habilitado: true,
      intervaloMs: 900_000,
      ventanaHoras: 48,
    });
    expect(
      configuracionResumenVentas({ REPORTES_RESUMEN_HABILITADO: 'false' })
        .habilitado,
    ).toBe(false);
    expect(configuracionResumenVentas({ NODE_ENV: 'test' }).habilitado).toBe(
      false,
    );
    expect(
      configuracionResumenVentas({
        NODE_ENV: 'test',
        REPORTES_RESUMEN_HABILITADO: 'TRUE',
      }).habilitado,
    ).toBe(true);
  });

  it('[TC-U-281] toma los valores de las variables; los inválidos usan los de por defecto', () => {
    expect(
      configuracionResumenVentas({
        REPORTES_RESUMEN_INTERVALO_MIN: '5',
        REPORTES_RESUMEN_VENTANA_HORAS: '24',
      }),
    ).toMatchObject({ intervaloMs: 300_000, ventanaHoras: 24 });
    expect(
      configuracionResumenVentas({
        REPORTES_RESUMEN_INTERVALO_MIN: 'abc',
        REPORTES_RESUMEN_VENTANA_HORAS: '-3',
      }),
    ).toMatchObject({ intervaloMs: 900_000, ventanaHoras: 48 });
  });
});

describe('ResumenVentasJob', () => {
  const entornoOriginal = process.env;
  let moduleRef: { resolve: jest.Mock };
  let servicio: { recalcularVentana: jest.Mock };
  let prisma: { tenant: { findMany: jest.Mock } };

  function crearJob(env: NodeJS.ProcessEnv = {}): ResumenVentasJob {
    process.env = { ...entornoOriginal, NODE_ENV: 'production', ...env };
    return new ResumenVentasJob(moduleRef as any, prisma as any);
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    servicio = {
      recalcularVentana: jest.fn().mockResolvedValue({ ventas: 1, platos: 2 }),
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

  it('[TC-U-282] recalcula las últimas horas de todos los establecimientos, resolviendo el servicio una sola vez', async () => {
    const job = crearJob({ REPORTES_RESUMEN_VENTANA_HORAS: '3' });
    const ahora = new Date('2026-11-02T15:42:00.000Z');

    const corrida = await job.ejecutar(ahora);
    await job.ejecutar(ahora);

    const ventana = {
      desde: new Date('2026-11-02T13:00:00.000Z'),
      hasta: new Date('2026-11-02T16:00:00.000Z'),
    };
    expect(servicio.recalcularVentana).toHaveBeenCalledWith('t1', ventana);
    expect(servicio.recalcularVentana).toHaveBeenCalledWith('t2', ventana);
    expect(corrida).toEqual({ establecimientos: 2, errores: 0 });
    expect(moduleRef.resolve).toHaveBeenCalledTimes(1);
    // Sin errores no escribe en el log.
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });

  it('[TC-U-283] un establecimiento que falla no frena a los demás y queda en el log', async () => {
    servicio.recalcularVentana
      .mockRejectedValueOnce(new Error('base caída'))
      .mockResolvedValueOnce({ ventas: 0, platos: 0 });
    const job = crearJob();

    const corrida = await job.ejecutar();

    expect(servicio.recalcularVentana).toHaveBeenCalledTimes(2);
    expect(corrida).toEqual({ establecimientos: 1, errores: 1 });
    expect(Logger.prototype.error).toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('[TC-U-284] nunca lanza: si no puede listar los establecimientos, lo deja en el log', async () => {
    prisma.tenant.findMany.mockRejectedValue(new Error('sin conexión'));
    const job = crearJob();

    await expect(job.ejecutar()).resolves.toEqual({
      establecimientos: 0,
      errores: 0,
    });
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('[TC-U-285] si una corrida sigue en curso, la siguiente se saltea', async () => {
    let terminar!: () => void;
    servicio.recalcularVentana.mockReturnValue(
      new Promise((resolve) => {
        terminar = () => resolve({ ventas: 0, platos: 0 });
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
    await expect(primera).resolves.toEqual({ establecimientos: 1, errores: 0 });
  });

  it('[TC-U-311] habilitado programa el timer con el intervalo, corre el job en cada vuelta y se apaga al cerrar', async () => {
    jest.useFakeTimers();
    const job = crearJob({ REPORTES_RESUMEN_INTERVALO_MIN: '5' });
    const ejecutar = jest.spyOn(job, 'ejecutar').mockResolvedValue(null);

    job.onApplicationBootstrap();
    jest.advanceTimersByTime(5 * 60_000);

    expect(ejecutar).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.stringContaining('cada 5 min'),
    );

    job.onModuleDestroy();
    jest.advanceTimersByTime(5 * 60_000);
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it('[TC-U-286] deshabilitado no programa el timer', () => {
    const espia = jest.spyOn(global, 'setInterval');
    const job = crearJob({ REPORTES_RESUMEN_HABILITADO: 'false' });

    job.onApplicationBootstrap();

    expect(espia).not.toHaveBeenCalled();
    job.onModuleDestroy();
  });
});
