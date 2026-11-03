import { Logger } from '@nestjs/common';
import { EstadoDgiService } from '../../src/cfe/estado-dgi/estado-dgi.service';
import {
  claveSerieNumero,
  esEstadoDefinitivo,
  estadoDgiDesdeCodigo,
  fechaUruguay,
} from '../../src/cfe/estado-dgi/estado-dgi';

// HU-009 (BL-455): estado de los CFE ante la DGI.

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

  it('la clave de serie y número no depende de mayúsculas ni espacios', () => {
    expect(claveSerieNumero(' a ', 49)).toBe(claveSerieNumero('A', 49));
  });
});

describe('EstadoDgiService.actualizarTenant', () => {
  let tx: {
    comprobanteFiscal: { findMany: jest.Mock; updateMany: jest.Mock };
    tenant: { findUnique: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let surtec: { configurado: jest.Mock; consultarEmitidos: jest.Mock };
  let service: EstadoDgiService;

  const pendiente = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    proveedorRef: `${id}-ref`,
    serie: 'A',
    numero: Number(id.replace(/\D/g, '')) || 1,
    fechaEmision: new Date('2026-11-01T14:00:00.000Z'),
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

  beforeEach(() => {
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
      consultarEmitidos: jest.fn().mockResolvedValue([]),
    };
    service = new EstadoDgiService(tenantPrisma as any, surtec as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('busca los PENDIENTES de Surtec de los últimos días, dentro del tenant', async () => {
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
      }),
    );
  });

  it('consulta a Surtec con el RUT del local, desde el más viejo hasta hoy (hora de Uruguay)', async () => {
    await service.actualizarTenant(TENANT_ID, 7, AHORA);

    expect(surtec.consultarEmitidos).toHaveBeenCalledWith({
      rutEmisor: '214198620015',
      fechaDesde: '2026-11-01',
      fechaHasta: '2026-11-03',
    });
  });

  it('empareja por el id de Surtec y guarda el estado con el motivo, condicionado a PENDIENTE', async () => {
    surtec.consultarEmitidos.mockResolvedValue([
      emitido({ id: 'c1-ref', codigoDgi: 'AE', motivoDgi: 'Recibido' }),
    ]);

    const resumen = await service.actualizarTenant(TENANT_ID, 7, AHORA);

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

  it('sin id de Surtec, empareja por serie y número', async () => {
    tx.comprobanteFiscal.findMany.mockResolvedValue([
      pendiente('c7', { proveedorRef: null }),
    ]);
    surtec.consultarEmitidos.mockResolvedValue([
      emitido({ id: 'otro', serie: 'A', numero: 7, codigoDgi: 'CE' }),
    ]);

    await service.actualizarTenant(TENANT_ID, 7, AHORA);

    expect(tx.comprobanteFiscal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c7', estadoDgi: 'PENDIENTE' },
        data: expect.objectContaining({ estadoDgi: 'OBSERVADO' }),
      }),
    );
  });

  it('un rechazo de DGI (BE) se cuenta y queda como advertencia en el log', async () => {
    surtec.consultarEmitidos.mockResolvedValue([
      emitido({ id: 'c1-ref', codigoDgi: 'BE' }),
    ]);

    const resumen = await service.actualizarTenant(TENANT_ID, 7, AHORA);

    expect(resumen.rechazados).toBe(1);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('rechazó'),
    );
  });

  it('sin respuesta de DGI o si Surtec no lo devuelve, sigue PENDIENTE', async () => {
    tx.comprobanteFiscal.findMany.mockResolvedValue([
      pendiente('c1'),
      pendiente('c2'),
    ]);
    surtec.consultarEmitidos.mockResolvedValue([
      emitido({ id: 'c1-ref', codigoDgi: null }),
    ]);

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
      expect.stringMatching(/devolvió 1 CFE y no están A-2/),
    );
  });

  it('si otra corrida ya lo actualizó (count 0), no lo cuenta dos veces', async () => {
    surtec.consultarEmitidos.mockResolvedValue([
      emitido({ id: 'c1-ref', codigoDgi: 'AE' }),
    ]);
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

    expect(surtec.consultarEmitidos).not.toHaveBeenCalled();
  });

  it('si Surtec falla, lanza (el job lo registra y sigue)', async () => {
    surtec.consultarEmitidos.mockRejectedValue(new Error('HTTP 503'));

    await expect(service.actualizarTenant(TENANT_ID, 7, AHORA)).rejects.toThrow(
      'HTTP 503',
    );
  });
});
