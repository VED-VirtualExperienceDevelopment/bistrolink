import { Prisma } from '@prisma/client';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  ComprobantesService,
  TAMANO_PAGINA_COMPROBANTES,
} from '../../src/comprobantes/comprobantes.service';
import { ComprobantesController } from '../../src/comprobantes/comprobantes.controller';
import { RolesGuard, ROLES_KEY } from '../../src/auth/roles.guard';

// HU-009 (BL-455): listado de comprobantes del administrador.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
// 15:00 en Uruguay del 3/11.
const AHORA = new Date('2026-11-03T18:00:00.000Z');

function fila(extra: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    fechaEmision: new Date('2026-11-03T14:00:00.000Z'),
    tipoCfe: '111',
    serie: 'A',
    numero: 49,
    pedidoId: 'p1',
    estadoDgi: 'ACEPTADO',
    estadoDgiMotivo: null,
    urlConsulta: 'https://www.efactura.dgi.gub.uy/consultaQR/cfe?x',
    pago: { monto: new Prisma.Decimal('1220') },
    pedido: {
      canal: 'QR',
      mesa: { numero: 5, esVirtual: false },
      lineas: [{ subtotal: new Prisma.Decimal('1220') }],
    },
    ...extra,
  };
}

describe('ComprobantesService.consultar', () => {
  let tx: { comprobanteFiscal: { findMany: jest.Mock } };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let service: ComprobantesService;

  beforeEach(() => {
    tx = { comprobanteFiscal: { findMany: jest.fn().mockResolvedValue([]) } };
    tenantPrisma = {
      runInTenantContext: jest.fn((_t, callback) => callback(tx)),
    };
    service = new ComprobantesService(
      tenantPrisma as any,
      {} as any,
      {} as any,
    );
  });

  const where = () => tx.comprobanteFiscal.findMany.mock.calls[0][0].where;

  it('sin fechas: los de hoy en Uruguay, dentro del tenant (RLS)', async () => {
    const r = await service.consultar(TENANT_ID, {}, AHORA);

    expect(tenantPrisma.runInTenantContext).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Function),
    );
    expect(where()).toEqual({
      fechaEmision: {
        gte: new Date('2026-11-03T03:00:00.000Z'),
        lt: new Date('2026-11-04T03:00:00.000Z'),
      },
    });
    expect(r).toMatchObject({ desde: '2026-11-03', hasta: '2026-11-03' });
  });

  it('con rango y estado', async () => {
    await service.consultar(
      TENANT_ID,
      { desde: '2026-11-01', hasta: '2026-11-02', estado: 'RECHAZADO' },
      AHORA,
    );

    expect(where()).toEqual({
      fechaEmision: {
        gte: new Date('2026-11-01T03:00:00.000Z'),
        lt: new Date('2026-11-03T03:00:00.000Z'),
      },
      estadoDgi: 'RECHAZADO',
    });
  });

  it('solo «desde»: hasta hoy; solo «hasta»: ese día', async () => {
    await expect(
      service.consultar(TENANT_ID, { desde: '2026-11-01' }, AHORA),
    ).resolves.toMatchObject({ desde: '2026-11-01', hasta: '2026-11-03' });
    await expect(
      service.consultar(TENANT_ID, { hasta: '2026-11-02' }, AHORA),
    ).resolves.toMatchObject({ desde: '2026-11-02', hasta: '2026-11-02' });
  });

  it.each([
    [{ desde: '2026-11-05', hasta: '2026-11-01' }, /anterior/],
    [{ desde: '2025-01-01', hasta: '2026-11-01' }, /366 días/],
    [{ desde: '2026-02-31' }, /inválida/],
  ])('rango %p => 400', async (filtros, mensaje) => {
    await expect(service.consultar(TENANT_ID, filtros, AHORA)).rejects.toThrow(
      mensaje,
    );
    expect(tx.comprobanteFiscal.findMany).not.toHaveBeenCalled();
  });

  it('arma cada fila: tipo, serie y número, mesa, monto del pago, estado y enlace de DGI', async () => {
    tx.comprobanteFiscal.findMany.mockResolvedValue([fila()]);

    const r = await service.consultar(TENANT_ID, {}, AHORA);

    expect(r.comprobantes).toEqual([
      {
        id: 'c1',
        fechaEmision: '2026-11-03T14:00:00.000Z',
        tipoCfe: '111',
        serie: 'A',
        numero: 49,
        pedidoId: 'p1',
        mesa: 5,
        canal: 'QR',
        monto: '1220.00',
        estadoDgi: 'ACEPTADO',
        estadoDgiMotivo: null,
        urlConsulta: 'https://www.efactura.dgi.gub.uy/consultaQR/cfe?x',
      },
    ]);
  });

  it('pedido para retirar: mesa null; sin pago: suma las líneas', async () => {
    tx.comprobanteFiscal.findMany.mockResolvedValue([
      fila({
        pago: null,
        pedido: {
          canal: 'WEB',
          mesa: { numero: 0, esVirtual: true },
          lineas: [
            { subtotal: new Prisma.Decimal('100.5') },
            { subtotal: new Prisma.Decimal('200') },
          ],
        },
      }),
    ]);

    const [c] = (await service.consultar(TENANT_ID, {}, AHORA)).comprobantes;

    expect(c).toMatchObject({ mesa: null, canal: 'WEB', monto: '300.50' });
  });

  it('pagina: pide uno de más para saber si hay otra página', async () => {
    tx.comprobanteFiscal.findMany.mockResolvedValue(
      Array.from({ length: TAMANO_PAGINA_COMPROBANTES + 1 }, (_, i) =>
        fila({ id: `c${i}` }),
      ),
    );

    const r = await service.consultar(TENANT_ID, { pagina: 2 }, AHORA);

    const args = tx.comprobanteFiscal.findMany.mock.calls[0][0];
    expect(args.skip).toBe(TAMANO_PAGINA_COMPROBANTES);
    expect(args.take).toBe(TAMANO_PAGINA_COMPROBANTES + 1);
    expect(r.hayMas).toBe(true);
    expect(r.comprobantes).toHaveLength(TAMANO_PAGINA_COMPROBANTES);
    // No selecciona datos del receptor de la e-Factura.
    expect(JSON.stringify(args.select)).not.toContain('receptor');
  });
});

describe('ComprobantesController', () => {
  it('solo ADMIN, con el token de Keycloak, y usa el tenant del token', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, ComprobantesController)).toEqual([
      'ADMIN',
    ]);
    const guards = Reflect.getMetadata(GUARDS_METADATA, ComprobantesController);
    expect(guards[1]).toBe(RolesGuard);

    const servicio = { consultar: jest.fn().mockResolvedValue({}) };
    const controller = new ComprobantesController(servicio as any, {} as any);
    await controller.consultar(
      { user: { sub: 'kc', tenantId: TENANT_ID, roles: ['ADMIN'] } } as any,
      { estado: 'PENDIENTE' },
    );
    expect(servicio.consultar).toHaveBeenCalledWith(TENANT_ID, {
      estado: 'PENDIENTE',
    });
  });

  it('HU-023 (BL-96): pendientes y reintentar usan el tenant y el actor del token', async () => {
    const servicio = {
      consultarPendientes: jest.fn().mockResolvedValue({}),
      reintentar: jest.fn().mockResolvedValue({}),
    };
    const cfe = { pdfDelComprobante: jest.fn().mockResolvedValue({}) };
    const controller = new ComprobantesController(servicio as any, cfe as any);
    const req = {
      user: { sub: 'kc', tenantId: TENANT_ID, roles: ['ADMIN'] },
    } as any;

    await controller.pendientes(req, { pagina: 2 });
    await controller.reintentar(req, 'pago-1');

    expect(servicio.consultarPendientes).toHaveBeenCalledWith(TENANT_ID, 2);

    // HU-009 (BL-454): PDF de un comprobante del tenant del token.
    await controller.pdf(req, 'comprobante-1');
    expect(cfe.pdfDelComprobante).toHaveBeenCalledWith(
      TENANT_ID,
      'comprobante-1',
    );
    expect(servicio.reintentar).toHaveBeenCalledWith(TENANT_ID, 'pago-1', {
      id: 'kc',
    });
  });
});

describe('ComprobantesService: pendientes de emisión (HU-023, BL-96)', () => {
  const entornoOriginal = process.env;
  let tx: {
    pago: { count: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let cfe: { configurado: jest.Mock; reintentar: jest.Mock };
  let auditLog: { registrar: jest.Mock };
  let service: ComprobantesService;

  const pagoSinCfe = (extra: Record<string, unknown> = {}) => ({
    id: 'pago-1',
    pedidoId: 'pedido-1',
    monto: new Prisma.Decimal('590'),
    medioPago: 'EFECTIVO',
    createdAt: new Date('2026-11-03T17:00:00.000Z'),
    cfeIntentos: 1,
    cfeUltimoIntentoEn: new Date('2026-11-03T17:01:00.000Z'),
    cfeUltimoError: 'Surtec rechazó la emisión (HTTP 503): {}',
    pedido: { canal: 'QR', mesa: { numero: 4, esVirtual: false } },
    ...extra,
  });

  beforeEach(() => {
    process.env = { ...entornoOriginal, NODE_ENV: 'production' };
    tx = {
      pago: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([pagoSinCfe()]),
        findUnique: jest.fn().mockResolvedValue({
          estado: 'APROBADO',
          _count: { comprobantes: 0 },
        }),
      },
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_t, callback) => callback(tx)),
    };
    cfe = {
      configurado: jest.fn().mockReturnValue(true),
      reintentar: jest.fn().mockResolvedValue({
        comprobante: {
          tipoCfe: '101',
          serie: 'A',
          numero: 7,
          urlConsulta: null,
        },
        error: null,
      }),
    };
    auditLog = { registrar: jest.fn() };
    service = new ComprobantesService(
      tenantPrisma as any,
      cfe as any,
      auditLog as any,
    );
  });

  afterEach(() => {
    process.env = entornoOriginal;
  });

  it('lista los aprobados sin CFE del tenant, del más viejo al más nuevo, con intentos y próximo intento', async () => {
    const r = await service.consultarPendientes(TENANT_ID, 1, AHORA);

    const args = tx.pago.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      estado: 'APROBADO',
      comprobantes: { none: {} },
    });
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(r).toMatchObject({ total: 1, pagina: 1, hayMas: false });
    expect(r.pendientes).toEqual([
      {
        pagoId: 'pago-1',
        pedidoId: 'pedido-1',
        mesa: 4,
        canal: 'QR',
        monto: '590.00',
        medioPago: 'EFECTIVO',
        fecha: '2026-11-03T17:00:00.000Z',
        intentos: 1,
        ultimoIntentoEn: '2026-11-03T17:01:00.000Z',
        ultimoError: 'Surtec rechazó la emisión (HTTP 503): {}',
        requiereAtencion: false,
        // 5 min después del primer intento fallido.
        proximoIntentoEn: '2026-11-03T17:06:00.000Z',
      },
    ]);
  });

  it('sin página ni fecha: la primera página, calculada con la hora actual', async () => {
    const r = await service.consultarPendientes(TENANT_ID);

    expect(tx.pago.findMany.mock.calls[0][0].skip).toBe(0);
    expect(r.pagina).toBe(1);
  });

  it('con 10 intentos o más de 3 días, requiere atención y no tiene próximo intento', async () => {
    tx.pago.findMany.mockResolvedValue([
      pagoSinCfe({ cfeIntentos: 10 }),
      pagoSinCfe({
        id: 'pago-2',
        createdAt: new Date('2026-10-30T12:00:00.000Z'),
        cfeIntentos: 0,
        cfeUltimoIntentoEn: null,
        pedido: { canal: 'WEB', mesa: { numero: 0, esVirtual: true } },
      }),
    ]);

    const { pendientes } = await service.consultarPendientes(
      TENANT_ID,
      1,
      AHORA,
    );

    expect(
      pendientes.map((p) => [p.requiereAtencion, p.proximoIntentoEn]),
    ).toEqual([
      [true, null],
      [true, null],
    ]);
    expect(pendientes[1].mesa).toBeNull();
  });

  it('reintentar: emite, responde el comprobante y lo audita sin el error', async () => {
    const r = await service.reintentar(TENANT_ID, 'pago-1', { id: 'kc-admin' });

    expect(cfe.reintentar).toHaveBeenCalledWith(TENANT_ID, 'pago-1');
    expect(r).toMatchObject({ emitido: true, error: null });
    expect(auditLog.registrar).toHaveBeenCalledWith({
      action: 'PAGO_CFE_REINTENTADO',
      tenantId: TENANT_ID,
      actorKeycloakId: 'kc-admin',
      entidadId: 'pago-1',
      detalle: { resultado: 'EMITIDO' },
    });
  });

  it('reintentar: si vuelve a fallar responde el error y audita FALLIDO', async () => {
    cfe.reintentar.mockResolvedValue({
      comprobante: null,
      error: 'Surtec rechazó la emisión (HTTP 400): {}',
    });

    const r = await service.reintentar(TENANT_ID, 'pago-1', { id: 'kc' });

    expect(r).toEqual({
      emitido: false,
      comprobante: null,
      error: 'Surtec rechazó la emisión (HTTP 400): {}',
    });
    expect(auditLog.registrar.mock.calls[0][0].detalle).toEqual({
      resultado: 'FALLIDO',
    });
  });

  it('reintentar: sin comprobante ni error (por ejemplo, el pago dejó de estar aprobado) audita SIN_EMITIR', async () => {
    cfe.reintentar.mockResolvedValue({ comprobante: null, error: null });

    const r = await service.reintentar(TENANT_ID, 'pago-1', { id: 'kc' });

    expect(r).toEqual({ emitido: false, comprobante: null, error: null });
    expect(auditLog.registrar.mock.calls[0][0].detalle).toEqual({
      resultado: 'SIN_EMITIR',
    });
  });

  it.each([
    ['pago de otro tenant o inexistente', null, 404],
    [
      'pago no aprobado',
      { estado: 'PENDIENTE', _count: { comprobantes: 0 } },
      409,
    ],
    [
      'pago que ya tiene CFE',
      { estado: 'APROBADO', _count: { comprobantes: 1 } },
      409,
    ],
  ])('reintentar: %s => %s', async (_caso, pago, status) => {
    tx.pago.findUnique.mockResolvedValue(pago);

    await expect(
      service.reintentar(TENANT_ID, 'pago-1', { id: 'kc' }),
    ).rejects.toMatchObject({ status });
    expect(cfe.reintentar).not.toHaveBeenCalled();
    expect(auditLog.registrar).not.toHaveBeenCalled();
  });

  it('reintentar: sin Surtec configurado => 409', async () => {
    cfe.configurado.mockReturnValue(false);

    await expect(
      service.reintentar(TENANT_ID, 'pago-1', { id: 'kc' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
