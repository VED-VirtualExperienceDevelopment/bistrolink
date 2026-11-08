import { Logger } from '@nestjs/common';
import { EstadoDgiJob } from '../../src/cfe/estado-dgi/estado-dgi.job';
import { configuracionEstadoDgi } from '../../src/cfe/estado-dgi/configuracion-estado-dgi';

// HU-009 (BL-455): job periódico del estado de los CFE ante la DGI.

const RESUMEN = {
  revisados: 3,
  actualizados: 2,
  rechazados: 1,
  noEncontrados: 0,
  sinRespuestaDgi: 1,
};

describe('configuracionEstadoDgi', () => {
  it('por defecto: habilitada, cada 10 min, los de los últimos 7 días, hasta 100 por corrida con 500 ms entre consultas', () => {
    expect(configuracionEstadoDgi({ NODE_ENV: 'production' })).toEqual({
      habilitada: true,
      intervaloMs: 600_000,
      dias: 7,
      maxPorCorrida: 100,
      pausaMs: 500,
    });
  });

  it('en los tests la pausa entre consultas es 0, salvo que se indique (BL-471)', () => {
    expect(configuracionEstadoDgi({ NODE_ENV: 'test' }).pausaMs).toBe(0);
    expect(
      configuracionEstadoDgi({ NODE_ENV: 'test', CFE_ESTADO_DGI_PAUSA_MS: '0' })
        .pausaMs,
    ).toBe(0);
    expect(
      configuracionEstadoDgi({ CFE_ESTADO_DGI_PAUSA_MS: '-5' }).pausaMs,
    ).toBe(500);
  });

  it('se puede apagar con CFE_ESTADO_DGI_HABILITADA=false', () => {
    expect(
      configuracionEstadoDgi({ CFE_ESTADO_DGI_HABILITADA: 'false' }).habilitada,
    ).toBe(false);
  });

  it('en los tests está apagada, salvo que se habilite a propósito', () => {
    expect(configuracionEstadoDgi({ NODE_ENV: 'test' }).habilitada).toBe(false);
    expect(
      configuracionEstadoDgi({
        NODE_ENV: 'test',
        CFE_ESTADO_DGI_HABILITADA: 'TRUE',
      }).habilitada,
    ).toBe(true);
  });

  it('toma los valores de las variables; los inválidos usan el default', () => {
    expect(
      configuracionEstadoDgi({
        CFE_ESTADO_DGI_INTERVALO_MIN: '5',
        CFE_ESTADO_DGI_DIAS: '3',
        CFE_ESTADO_DGI_MAX_POR_CORRIDA: '20',
        CFE_ESTADO_DGI_PAUSA_MS: '1000',
      }),
    ).toMatchObject({
      intervaloMs: 300_000,
      dias: 3,
      maxPorCorrida: 20,
      pausaMs: 1000,
    });
    expect(
      configuracionEstadoDgi({
        CFE_ESTADO_DGI_INTERVALO_MIN: 'abc',
        CFE_ESTADO_DGI_DIAS: '-1',
        CFE_ESTADO_DGI_MAX_POR_CORRIDA: '0',
      }),
    ).toMatchObject({ intervaloMs: 600_000, dias: 7, maxPorCorrida: 100 });
  });
});

describe('EstadoDgiJob', () => {
  const entornoOriginal = process.env;
  let moduleRef: { resolve: jest.Mock };
  let servicio: { actualizarTenant: jest.Mock };
  let prisma: { tenant: { findMany: jest.Mock } };

  function crearJob(env: NodeJS.ProcessEnv = {}): EstadoDgiJob {
    process.env = { ...entornoOriginal, NODE_ENV: 'production', ...env };
    return new EstadoDgiJob(moduleRef as any, prisma as any);
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    servicio = { actualizarTenant: jest.fn().mockResolvedValue(RESUMEN) };
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

  it('recorre todos los establecimientos con los días configurados y suma', async () => {
    const job = crearJob({ CFE_ESTADO_DGI_DIAS: '5' });
    const ahora = new Date('2026-11-03T12:00:00.000Z');

    const total = await job.ejecutar(ahora);

    expect(servicio.actualizarTenant).toHaveBeenCalledWith('t1', 5, ahora);
    expect(servicio.actualizarTenant).toHaveBeenCalledWith('t2', 5, ahora);
    expect(total).toEqual({
      revisados: 6,
      actualizados: 4,
      rechazados: 2,
      noEncontrados: 0,
      sinRespuestaDgi: 2,
    });
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          '2 rechazados, 2 sin respuesta de DGI, 0 no encontrados en Surtec',
        ),
      }),
    );
  });

  it('resuelve el servicio una sola vez y lo reutiliza', async () => {
    const job = crearJob();

    await job.ejecutar();
    await job.ejecutar();

    expect(moduleRef.resolve).toHaveBeenCalledTimes(1);
  });

  it('un establecimiento que falla (Surtec caído) no frena a los demás', async () => {
    servicio.actualizarTenant
      .mockRejectedValueOnce(new Error('Surtec caído'))
      .mockResolvedValueOnce(RESUMEN);
    const job = crearJob();

    const total = await job.ejecutar();

    expect(servicio.actualizarTenant).toHaveBeenCalledTimes(2);
    expect(total).toMatchObject({ revisados: 3 });
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('nunca lanza: si no puede listar los establecimientos, lo deja en el log', async () => {
    prisma.tenant.findMany.mockRejectedValue(new Error('sin conexión'));

    await expect(crearJob().ejecutar()).resolves.toEqual({
      revisados: 0,
      actualizados: 0,
      rechazados: 0,
      noEncontrados: 0,
      sinRespuestaDgi: 0,
    });
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('sin novedades no escribe nada en el log', async () => {
    servicio.actualizarTenant.mockResolvedValue({
      revisados: 0,
      actualizados: 0,
      rechazados: 0,
      noEncontrados: 0,
      sinRespuestaDgi: 0,
    });

    await crearJob().ejecutar();

    expect(Logger.prototype.log).not.toHaveBeenCalled();
  });

  it('si una corrida sigue en curso, la siguiente se saltea', async () => {
    let terminar!: () => void;
    servicio.actualizarTenant.mockReturnValue(
      new Promise((resolve) => {
        terminar = () => resolve(RESUMEN);
      }),
    );
    prisma.tenant.findMany.mockResolvedValue([{ id: 't1' }]);
    const job = crearJob();

    const primera = job.ejecutar();
    await Promise.resolve();
    await expect(job.ejecutar()).resolves.toBeNull();
    while (!terminar) await Promise.resolve();
    terminar();
    await expect(primera).resolves.toMatchObject({ revisados: 3 });
  });

  it('arranca el timer solo si está habilitado, y lo apaga al cerrar', () => {
    jest.useFakeTimers();
    const job = crearJob();
    const ejecutar = jest.spyOn(job, 'ejecutar').mockResolvedValue(null);

    job.onApplicationBootstrap();
    jest.advanceTimersByTime(600_000);
    expect(ejecutar).toHaveBeenCalledTimes(1);

    job.onModuleDestroy();
    jest.advanceTimersByTime(600_000);
    expect(ejecutar).toHaveBeenCalledTimes(1);

    const apagado = crearJob({ CFE_ESTADO_DGI_HABILITADA: 'false' });
    const ejecutarApagado = jest
      .spyOn(apagado, 'ejecutar')
      .mockResolvedValue(null);
    apagado.onApplicationBootstrap();
    jest.advanceTimersByTime(600_000);
    expect(ejecutarApagado).not.toHaveBeenCalled();
  });
});
