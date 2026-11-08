import { Logger } from '@nestjs/common';
import { EstadoDgiService } from '../../src/cfe/estado-dgi/estado-dgi.service';
import {
  esEstadoDefinitivo,
  estadoDgiDesdeCodigo,
  fechaUruguay,
} from '../../src/cfe/estado-dgi/estado-dgi';

// HU-009 (BL-455): estado de los CFE ante la DGI. Desde BL-471 se consulta
// cada CFE en la API v2 de Surtec (por id o por id_externo).

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const AHORA = new Date('2026-11-03T15:00:00.000Z');

describe('estado-dgi (helpers)', () => {
  it.each([
    ['AE', 'ACEPTADO'],
    ['BE', 'RECHAZADO'],
    ['CE', 'OBSERVADO'],
    [' ae ', 'ACEPTADO'],
    // «No enviado»: Surtec todavía no lo mandó a la DGI (visto en staging).
    ['NE', 'PENDIENTE'],
    ['XX', 'PENDIENTE'],
    [null, 'PENDIENTE'],
    [undefined, 'PENDIENTE'],
  ])('código %p => %s', (codigo, estado) => {
    expect(estadoDgiDesdeCodigo(codigo)).toBe(estado);
  });

  it('solo PENDIENTE no es definitivo', () => {
    expect(esEstadoDefinitivo('PENDIENTE')).toBe(false);
    for (const e of ['ACEPTADO', 'RECHAZADO', 'OBSERVADO'] as const) {
      expect(esEstadoDefinitivo(e)).toBe(true);
    }
  });

  it('la fecha va en hora de Uruguay (UTC−3)', () => {
    expect(fechaUruguay(new Date('2026-11-03T01:30:00.000Z'))).toBe(
      '2026-11-02',
    );
    expect(fechaUruguay(new Date('2026-11-03T03:00:00.000Z'))).toBe(
      '2026-11-03',
    );
  });
});

describe('EstadoDgiService.actualizarTenant', () => {
  const entornoOriginal = process.env;
  let tx: {
    comprobanteFiscal: { findMany: jest.Mock; updateMany: jest.Mock };
    tenant: { findUnique: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let surtec: {
    configurado: jest.Mock;
    consultarEmitido: jest.Mock;
    buscarEmitidoPorIdExterno: jest.Mock;
  };
  let service: EstadoDgiService;

  const pendiente = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    proveedorRef: `${id}-ref`,
    idExterno: `bl-${id}`,
    serie: 'A',
    numero: Number(id.replace(/\D/g, '')) || 1,
    ...extra,
  });
  const emitido = (extra: Record<string, unknown>) => ({
    id: 'x',
    serie: 'A',
    numero: 0,
    codigoDgi: null,
    motivoDgi: null,
    ...extra,
  });
  const crear = () => new EstadoDgiService(tenantPrisma as any, surtec as any);

  beforeEach(() => {
    process.env = { ...entornoOriginal, NODE_ENV: 'test' };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    tx = {
      comprobanteFiscal: {
        findMany: jest.fn().mockResolvedValue([pendiente('c1')]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ rut: '214198620015' }),
      },
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_t, callback) => callback(tx)),
    };
    surtec = {
      configurado: jest.fn().mockReturnValue(true),
      consultarEmitido: jest.fn().mockResolvedValue(null),
      buscarEmitidoPorIdExterno: jest.fn().mockResolvedValue(null),
    };
    service = crear();
  });

  afterEach(() => {
    process.env = entornoOriginal;
    jest.restoreAllMocks();
  });

  it('busca los PENDIENTES de Surtec de los últimos días, dentro del tenant, los más nuevos primero y con tope', async () => {
    await service.actualizarTenant(TENANT_ID, 7, AHORA);

    expect(tenantPrisma.runInTenantContext).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Function),
    );
    expect(tx.comprobanteFiscal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          proveedor: 'SURTEC',
          estadoDgi: 'PENDIENTE',
          fechaEmision: { gte: new Date('2026-10-27T15:00:00.000Z') },
        },
        orderBy: { fechaEmision: 'desc' },
        take: 100,
      }),
    );
  });

  it('el tope sale de CFE_ESTADO_DGI_MAX_POR_CORRIDA', async () => {
    process.env.CFE_ESTADO_DGI_MAX_POR_CORRIDA = '20';

    await crear().actualizarTenant(TENANT_ID, 7, AHORA);

    expect(tx.comprobanteFiscal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
  });

  it('consulta cada CFE por su id de Surtec, con el RUT del local, y guarda el estado con el motivo, condicionado a PENDIENTE', async () => {
    surtec.consultarEmitido.mockResolvedValue(
      emitido({ id: 'c1-ref', codigoDgi: 'AE', motivoDgi: 'Recibido' }),
    );

    const resumen = await service.actualizarTenant(TENANT_ID, 7, AHORA);

    expect(surtec.consultarEmitido).toHaveBeenCalledWith(
      '214198620015',
      'c1-ref',
    );
    expect(surtec.buscarEmitidoPorIdExterno).not.toHaveBeenCalled();
    expect(tx.comprobanteFiscal.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', estadoDgi: 'PENDIENTE' },
      data: {
        estadoDgi: 'ACEPTADO',
        estadoDgiMotivo: 'Recibido',
        estadoDgiActualizadoEn: AHORA,
      },
    });
    expect(resumen).toEqual({
      revisados: 1,
      actualizados: 1,
      rechazados: 0,
      noEncontrados: 0,
      sinRespuestaDgi: 0,
    });
  });

  it('sin id de Surtec, lo busca por el id_externo; sin ninguno de los dos, no consulta', async () => {
    tx.comprobanteFiscal.findMany.mockResolvedValue([
      pendiente('c7', { proveedorRef: null }),
      pendiente('c8', { proveedorRef: null, idExterno: null }),
    ]);
    surtec.buscarEmitidoPorIdExterno.mockResolvedValue(
      emitido({ id: 'otro', codigoDgi: 'CE' }),
    );

    const resumen = await service.actualizarTenant(TENANT_ID, 7, AHORA);

    expect(surtec.buscarEmitidoPorIdExterno).toHaveBeenCalledTimes(1);
    expect(surtec.buscarEmitidoPorIdExterno).toHaveBeenCalledWith(
      '214198620015',
      'bl-c7',
    );
    expect(surtec.consultarEmitido).not.toHaveBeenCalled();
    expect(tx.comprobanteFiscal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c7', estadoDgi: 'PENDIENTE' },
        data: expect.objectContaining({ estadoDgi: 'OBSERVADO' }),
      }),
    );
    expect(resumen.noEncontrados).toBe(1);
  });

  it('un rechazo de DGI (BE) se cuenta y queda como advertencia en el log', async () => {
    surtec.consultarEmitido.mockResolvedValue(
      emitido({ id: 'c1-ref', codigoDgi: 'BE' }),
    );

    const resumen = await service.actualizarTenant(TENANT_ID, 7, AHORA);

    expect(resumen.rechazados).toBe(1);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('rechazó'),
    );
  });

  it('sin respuesta de DGI (NE) o si Surtec no lo tiene, sigue PENDIENTE', async () => {
    tx.comprobanteFiscal.findMany.mockResolvedValue([
      pendiente('c1'),
      pendiente('c2'),
    ]);
    surtec.consultarEmitido
      .mockResolvedValueOnce(emitido({ id: 'c1-ref', codigoDgi: 'NE' }))
      .mockResolvedValueOnce(null);

    const resumen = await service.actualizarTenant(TENANT_ID, 7, AHORA);

    expect(tx.comprobanteFiscal.updateMany).not.toHaveBeenCalled();
    expect(resumen).toEqual({
      revisados: 2,
      actualizados: 0,
      rechazados: 0,
      noEncontrados: 1,
      sinRespuestaDgi: 1,
    });
    // El que no está se avisa con serie y número, para diagnosticar.
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringMatching(/no tiene 1 de 2 CFE consultados: A-2/),
    );
  });

  it('con más de 10 no encontrados, el aviso lista 10 y sigue con «…»', async () => {
    tx.comprobanteFiscal.findMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => pendiente(`c${i + 1}`)),
    );

    await service.actualizarTenant(TENANT_ID, 7, AHORA);

    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringMatching(/A-10…$/),
    );
  });

  it('entre una consulta y la siguiente hace la pausa de CFE_ESTADO_DGI_PAUSA_MS', async () => {
    process.env.CFE_ESTADO_DGI_PAUSA_MS = '1';
    const conPausa = crear();
    const esperar = jest
      .spyOn(conPausa as any, 'esperar')
      .mockResolvedValue(undefined);
    tx.comprobanteFiscal.findMany.mockResolvedValue([
      pendiente('c1'),
      pendiente('c2'),
      pendiente('c3'),
    ]);

    await conPausa.actualizarTenant(TENANT_ID, 7, AHORA);

    expect(esperar).toHaveBeenCalledTimes(2);
    expect(esperar).toHaveBeenCalledWith(1);
  });

  it('la pausa espera de verdad los milisegundos indicados', async () => {
    jest.useFakeTimers();
    try {
      let listo = false;
      const promesa = (service as any).esperar(500).then(() => {
        listo = true;
      });
      await jest.advanceTimersByTimeAsync(499);
      expect(listo).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await promesa;
      expect(listo).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('si otra corrida ya lo actualizó (count 0), no lo cuenta dos veces', async () => {
    surtec.consultarEmitido.mockResolvedValue(
      emitido({ id: 'c1-ref', codigoDgi: 'AE' }),
    );
    tx.comprobanteFiscal.updateMany.mockResolvedValue({ count: 0 });

    const resumen = await service.actualizarTenant(TENANT_ID, 7, AHORA);

    expect(resumen.actualizados).toBe(0);
  });

  it('sin pendientes, sin RUT o con Surtec sin configurar no consulta', async () => {
    tx.comprobanteFiscal.findMany.mockResolvedValueOnce([]);
    await service.actualizarTenant(TENANT_ID, 7, AHORA);

    tx.tenant.findUnique.mockResolvedValueOnce(null);
    await service.actualizarTenant(TENANT_ID, 7, AHORA);

    surtec.configurado.mockReturnValueOnce(false);
    await expect(
      service.actualizarTenant(TENANT_ID, 7, AHORA),
    ).resolves.toEqual({
      revisados: 0,
      actualizados: 0,
      rechazados: 0,
      noEncontrados: 0,
      sinRespuestaDgi: 0,
    });

    expect(surtec.consultarEmitido).not.toHaveBeenCalled();
  });

  it('si Surtec falla, lanza (el job lo registra y sigue)', async () => {
    surtec.consultarEmitido.mockRejectedValue(new Error('HTTP 503'));

    await expect(service.actualizarTenant(TENANT_ID, 7, AHORA)).rejects.toThrow(
      'HTTP 503',
    );
  });
});
