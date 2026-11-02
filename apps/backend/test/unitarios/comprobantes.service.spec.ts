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
    service = new ComprobantesService(tenantPrisma as any);
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
    const controller = new ComprobantesController(servicio as any);
    await controller.consultar(
      { user: { sub: 'kc', tenantId: TENANT_ID, roles: ['ADMIN'] } } as any,
      { estado: 'PENDIENTE' },
    );
    expect(servicio.consultar).toHaveBeenCalledWith(TENANT_ID, {
      estado: 'PENDIENTE',
    });
  });
});
