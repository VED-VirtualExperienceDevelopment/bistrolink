import { Logger } from '@nestjs/common';
import { ReglasComplementoJob } from '../../src/complementos/reglas-complemento.job';
import {
  configuracionReglasComplemento,
  fechaYHoraLocal,
  tocaRecalcular,
} from '../../src/complementos/configuracion-reglas-complemento';

/** HU-046 (BL-552): job nocturno de las reglas de complemento. */

const MONTEVIDEO = 'America/Montevideo';

describe('configuracionReglasComplemento', () => {
  it('por defecto: habilitado, desde las 4 de Montevideo y chequeo cada 15 min; en los tests apagado salvo a propósito', () => {
    expect(configuracionReglasComplemento({ NODE_ENV: 'production' })).toEqual({
      habilitado: true,
      hora: 4,
      chequeoMs: 900_000,
      zonaHoraria: MONTEVIDEO,
    });
    expect(
      configuracionReglasComplemento({
        COMPLEMENTOS_REGLAS_HABILITADO: 'false',
      }).habilitado,
    ).toBe(false);
    expect(
      configuracionReglasComplemento({ NODE_ENV: 'test' }).habilitado,
    ).toBe(false);
    expect(
      configuracionReglasComplemento({
        NODE_ENV: 'test',
        COMPLEMENTOS_REGLAS_HABILITADO: 'TRUE',
      }).habilitado,
    ).toBe(true);
  });

  it.each([
    ['0', 0],
    ['23', 23],
    ['24', 4],
    ['-1', 4],
    ['3.5', 4],
    ['abc', 4],
    ['  ', 4],
  ])('COMPLEMENTOS_REGLAS_HORA=%p → %p', (valor, hora) => {
    expect(
      configuracionReglasComplemento({ COMPLEMENTOS_REGLAS_HORA: valor }).hora,
    ).toBe(hora);
  });
});

describe('tocaRecalcular', () => {
  const config = { hora: 4, zonaHoraria: MONTEVIDEO };

  it('la fecha y la hora son las de Montevideo (UTC-3)', () => {
    expect(
      fechaYHoraLocal(new Date('2026-11-15T02:30:00.000Z'), MONTEVIDEO),
    ).toEqual({ fecha: '2026-11-14', hora: 23 });
  });

  it('antes de la hora no toca; después, una vez por día', () => {
    // 03:59 de Montevideo.
    expect(
      tocaRecalcular(new Date('2026-11-15T06:59:00.000Z'), config, null),
    ).toEqual({ toca: false, fecha: '2026-11-15' });
    // 04:00.
    expect(
      tocaRecalcular(new Date('2026-11-15T07:00:00.000Z'), config, null),
    ).toEqual({ toca: true, fecha: '2026-11-15' });
    // Ya corrió hoy.
    expect(
      tocaRecalcular(new Date('2026-11-15T20:00:00.000Z'), config, '2026-11-15')
        .toca,
    ).toBe(false);
    // Al otro día, otra vez.
    expect(
      tocaRecalcular(new Date('2026-11-16T07:15:00.000Z'), config, '2026-11-15')
        .toca,
    ).toBe(true);
  });

  it('si la API arranca de tarde y hoy no corrió, toca', () => {
    expect(
      tocaRecalcular(new Date('2026-11-15T18:00:00.000Z'), config, null).toca,
    ).toBe(true);
  });
});

describe('ReglasComplementoJob', () => {
  const entornoOriginal = process.env;
  let moduleRef: { resolve: jest.Mock };
  let servicio: { recalcular: jest.Mock };
  let prisma: { tenant: { findMany: jest.Mock } };

  function crearJob(env: NodeJS.ProcessEnv = {}): ReglasComplementoJob {
    process.env = { ...entornoOriginal, NODE_ENV: 'production', ...env };
    return new ReglasComplementoJob(moduleRef as any, prisma as any);
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    servicio = { recalcular: jest.fn().mockResolvedValue({ reglas: 0 }) };
    moduleRef = { resolve: jest.fn().mockResolvedValue(servicio) };
    prisma = {
      tenant: {
        findMany: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]),
      },
    };
  });

  afterEach(() => {
    process.env = entornoOriginal;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('recalcula cada establecimiento; uno que falla no frena a los demás y queda en el log', async () => {
    servicio.recalcular.mockRejectedValueOnce(new Error('se cortó'));
    const job = crearJob();
    const ahora = new Date('2026-11-15T07:00:00.000Z');

    await expect(job.ejecutar(ahora)).resolves.toEqual({
      establecimientos: 1,
      errores: 1,
    });
    expect(servicio.recalcular).toHaveBeenCalledWith('t1', ahora);
    expect(servicio.recalcular).toHaveBeenCalledWith('t2', ahora);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('falló en el tenant t1'),
      expect.any(String),
    );
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('sin fallos no registra nada; si no puede listar los locales, no lanza', async () => {
    const job = crearJob();
    await job.ejecutar();
    expect(Logger.prototype.warn).not.toHaveBeenCalled();

    prisma.tenant.findMany.mockRejectedValueOnce(new Error('sin base'));
    await expect(job.ejecutar()).resolves.toEqual({
      establecimientos: 0,
      errores: 0,
    });
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('no se pudo ejecutar'),
      expect.any(String),
    );
  });

  it('nunca hay dos corridas a la vez', async () => {
    let terminar: () => void = () => undefined;
    servicio.recalcular.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        terminar = resolve;
      }),
    );
    const job = crearJob();
    const primera = job.ejecutar();
    await new Promise((r) => setImmediate(r));
    await expect(job.ejecutar()).resolves.toBeNull();
    await expect(
      job.siToca(new Date('2026-11-15T07:00:00.000Z')),
    ).resolves.toBeNull();
    terminar();
    await primera;
  });

  it('siToca corre una vez por día, desde la hora configurada', async () => {
    const job = crearJob();
    await expect(
      job.siToca(new Date('2026-11-15T06:00:00.000Z')),
    ).resolves.toBeNull();
    await expect(
      job.siToca(new Date('2026-11-15T07:05:00.000Z')),
    ).resolves.toEqual({ establecimientos: 2, errores: 0 });
    await expect(
      job.siToca(new Date('2026-11-15T07:20:00.000Z')),
    ).resolves.toBeNull();
    await expect(
      job.siToca(new Date('2026-11-16T07:05:00.000Z')),
    ).resolves.not.toBeNull();
    expect(prisma.tenant.findMany).toHaveBeenCalledTimes(2);
  });

  it('deshabilitado no arma el timer; habilitado revisa cada 15 minutos', () => {
    jest.useFakeTimers();
    const apagado = crearJob({ COMPLEMENTOS_REGLAS_HABILITADO: 'false' });
    const espiaApagado = jest.spyOn(apagado, 'siToca');
    apagado.onApplicationBootstrap();
    jest.advanceTimersByTime(900_000);
    expect(espiaApagado).not.toHaveBeenCalled();

    const job = crearJob();
    const espia = jest.spyOn(job, 'siToca').mockResolvedValue(null);
    job.onApplicationBootstrap();
    jest.advanceTimersByTime(900_000);
    expect(espia).toHaveBeenCalledTimes(1);
    job.onModuleDestroy();
    jest.advanceTimersByTime(900_000);
    expect(espia).toHaveBeenCalledTimes(1);
  });
});
