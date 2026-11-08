import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PagosService } from '../../src/pagos/pagos.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';

function pago(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pago-1',
    estado: 'APROBADO',
    medioPago: 'MERCADOPAGO',
    monto: new Prisma.Decimal('590'),
    motivoRechazo: null,
    createdAt: new Date('2026-11-01T15:00:00Z'),
    comprobantes: [],
    ...overrides,
  };
}

describe('PagosService.consultar (BL-311: estado del pago y comprobante para el comensal)', () => {
  let findUnique: jest.Mock;
  let restauranteFindUnique: jest.Mock;
  let runInTenantContext: jest.Mock;
  let service: PagosService;

  beforeEach(() => {
    findUnique = jest.fn();
    restauranteFindUnique = jest.fn().mockResolvedValue({
      efectivoHabilitado: true,
      mercadoPagoHabilitado: true,
    });
    runInTenantContext = jest.fn((_tenantId, fn) =>
      fn({
        pedido: { findUnique },
        restaurante: { findUnique: restauranteFindUnique },
      }),
    );
    service = new PagosService(
      { runInTenantContext } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('pago aprobado con CFE emitido: devuelve serie, número y enlace de DGI', async () => {
    findUnique.mockResolvedValue({
      id: PEDIDO_ID,
      estado: 'RECIBIDO',
      pagos: [
        pago({
          comprobantes: [
            {
              tipoCfe: '111',
              serie: 'A',
              numero: 1234,
              urlConsulta: 'https://www.efactura.dgi.gub.uy/consultaQR/x',
            },
          ],
        }),
      ],
    });

    await expect(service.consultar(TENANT_ID, PEDIDO_ID)).resolves.toEqual({
      pedidoId: PEDIDO_ID,
      estadoPedido: 'RECIBIDO',
      pago: {
        id: 'pago-1',
        estado: 'APROBADO',
        medioPago: 'MERCADOPAGO',
        monto: '590.00',
        motivoRechazo: null,
      },
      comprobante: {
        tipoCfe: '111',
        serie: 'A',
        numero: 1234,
        urlConsulta: 'https://www.efactura.dgi.gub.uy/consultaQR/x',
      },
      efectivo: { disponible: false, solicitadoEn: null, pagaCon: null },
      tarjeta: { disponible: true },
      rebajaIva: null,
    });
  });

  it('HU-032 (BL-202): pago vencido => devuelve el motivo, para que el comensal sepa por qué', async () => {
    findUnique.mockResolvedValue({
      id: PEDIDO_ID,
      estado: 'PENDIENTE_PAGO',
      pagos: [pago({ estado: 'RECHAZADO', motivoRechazo: 'VENCIDO' })],
    });

    const r = await service.consultar(TENANT_ID, PEDIDO_ID);

    expect(r.pago).toMatchObject({
      estado: 'RECHAZADO',
      motivoRechazo: 'VENCIDO',
    });
  });

  it('pago aprobado pero el CFE todavía no se emitió: comprobante null (el frontend vuelve a consultar)', async () => {
    findUnique.mockResolvedValue({
      id: PEDIDO_ID,
      estado: 'RECIBIDO',
      pagos: [pago()],
    });

    const r = await service.consultar(TENANT_ID, PEDIDO_ID);

    expect(r.pago?.estado).toBe('APROBADO');
    expect(r.comprobante).toBeNull();
  });

  it('pedido sin pagos todavía: pago y comprobante null, con el estado del pedido', async () => {
    findUnique.mockResolvedValue({
      id: PEDIDO_ID,
      estado: 'PENDIENTE_PAGO',
      pagos: [],
    });

    await expect(service.consultar(TENANT_ID, PEDIDO_ID)).resolves.toEqual({
      pedidoId: PEDIDO_ID,
      estadoPedido: 'PENDIENTE_PAGO',
      pago: null,
      comprobante: null,
      efectivo: { disponible: false, solicitadoEn: null, pagaCon: null },
      tarjeta: { disponible: true },
      rebajaIva: null,
    });
  });

  it('rechazado y después aprobado: muestra el aprobado aunque no sea el último intento', async () => {
    // Orden de la consulta: createdAt desc (el primero es el más nuevo).
    findUnique.mockResolvedValue({
      id: PEDIDO_ID,
      estado: 'RECIBIDO',
      pagos: [
        pago({ id: 'pago-rechazado-2', estado: 'RECHAZADO' }),
        pago({ id: 'pago-ok', estado: 'APROBADO' }),
        pago({ id: 'pago-rechazado-1', estado: 'RECHAZADO' }),
      ],
    });

    const r = await service.consultar(TENANT_ID, PEDIDO_ID);

    expect(r.pago?.id).toBe('pago-ok');
  });

  it('solo intentos sin cobro: muestra el último (pendiente o rechazado)', async () => {
    findUnique.mockResolvedValue({
      id: PEDIDO_ID,
      estado: 'PENDIENTE_PAGO',
      pagos: [
        pago({ id: 'ultimo', estado: 'PENDIENTE' }),
        pago({ id: 'anterior', estado: 'RECHAZADO' }),
      ],
    });

    const r = await service.consultar(TENANT_ID, PEDIDO_ID);

    expect(r.pago).toMatchObject({ id: 'ultimo', estado: 'PENDIENTE' });
    expect(r.comprobante).toBeNull();
  });

  it('no expone datos internos del pago ni del comprobante (referencia de la pasarela, CAE, hash)', async () => {
    findUnique.mockResolvedValue({
      id: PEDIDO_ID,
      estado: 'RECIBIDO',
      pagos: [
        pago({
          comprobantes: [
            { tipoCfe: '101', serie: 'A', numero: 1, urlConsulta: null },
          ],
        }),
      ],
    });

    const r = await service.consultar(TENANT_ID, PEDIDO_ID);

    expect(Object.keys(r.pago!).sort()).toEqual([
      'estado',
      'id',
      'medioPago',
      'monto',
      'motivoRechazo',
    ]);
    // HU-009 (BL-453): tipoCfe dice si es e-Ticket o e-Factura.
    expect(Object.keys(r.comprobante!).sort()).toEqual([
      'numero',
      'serie',
      'tipoCfe',
      'urlConsulta',
    ]);
    // La consulta ni siquiera pide esos campos a la base.
    const { select } = findUnique.mock.calls[0][0];
    expect(select.pagos.select).not.toHaveProperty('pasarelaReferencia');
    expect(select.pagos.select.comprobantes.select).toEqual({
      tipoCfe: true,
      serie: true,
      numero: true,
      urlConsulta: true,
    });
  });

  it('consulta dentro del tenant del JWT (RLS)', async () => {
    findUnique.mockResolvedValue({
      id: PEDIDO_ID,
      estado: 'RECIBIDO',
      pagos: [],
    });

    await service.consultar(TENANT_ID, PEDIDO_ID);

    expect(runInTenantContext).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Function),
    );
  });

  it('pedido inexistente en el tenant: 404', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.consultar(TENANT_ID, PEDIDO_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('pago en efectivo (HU-031b, BL-442)', () => {
    const pendiente = (overrides: Record<string, unknown> = {}) => ({
      id: PEDIDO_ID,
      estado: 'PENDIENTE_PAGO',
      canal: 'QR',
      efectivoSolicitadoEn: null,
      efectivoPagaCon: null,
      pagos: [],
      ...overrides,
    });

    it('pedido de mesa en un local que acepta efectivo: disponible', async () => {
      findUnique.mockResolvedValue(pendiente());

      const r = await service.consultar(TENANT_ID, PEDIDO_ID);

      expect(r.efectivo).toEqual({
        disponible: true,
        solicitadoEn: null,
        pagaCon: null,
      });
    });

    it('pedido para retirar (fuera del local): no disponible', async () => {
      findUnique.mockResolvedValue(pendiente({ canal: 'WEB' }));

      const r = await service.consultar(TENANT_ID, PEDIDO_ID);

      expect(r.efectivo.disponible).toBe(false);
    });

    it('local sin efectivo habilitado: no disponible', async () => {
      restauranteFindUnique.mockResolvedValue({
        efectivoHabilitado: false,
        mercadoPagoHabilitado: true,
      });
      findUnique.mockResolvedValue(pendiente());

      const r = await service.consultar(TENANT_ID, PEDIDO_ID);

      expect(r.efectivo.disponible).toBe(false);
    });

    it('ya pidió efectivo: devuelve cuándo y con cuánto paga (al recargar, sigue esperando al mozo)', async () => {
      const cuando = new Date('2026-10-28T17:30:00.000Z');
      findUnique.mockResolvedValue(
        pendiente({
          efectivoSolicitadoEn: cuando,
          efectivoPagaCon: new Prisma.Decimal('1000'),
        }),
      );

      const r = await service.consultar(TENANT_ID, PEDIDO_ID);

      expect(r.efectivo).toEqual({
        disponible: true,
        solicitadoEn: cuando,
        pagaCon: '1000.00',
      });
    });
  });

  describe('BL-452: pago con tarjeta (Mercado Pago)', () => {
    beforeEach(() => {
      findUnique.mockResolvedValue({
        id: PEDIDO_ID,
        estado: 'PENDIENTE_PAGO',
        canal: 'QR',
        pagos: [],
      });
    });

    it('local con Mercado Pago habilitado: la tarjeta está disponible', async () => {
      const r = await service.consultar(TENANT_ID, PEDIDO_ID);

      expect(r.tarjeta).toEqual({ disponible: true });
      expect(restauranteFindUnique).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        select: { efectivoHabilitado: true, mercadoPagoHabilitado: true },
      });
    });

    it('local con Mercado Pago deshabilitado: la tarjeta no está disponible y el efectivo sigue igual', async () => {
      restauranteFindUnique.mockResolvedValue({
        efectivoHabilitado: true,
        mercadoPagoHabilitado: false,
      });

      const r = await service.consultar(TENANT_ID, PEDIDO_ID);

      expect(r.tarjeta).toEqual({ disponible: false });
      expect(r.efectivo.disponible).toBe(true);
    });

    it('pedido para retirar: la tarjeta depende solo de Mercado Pago (no del canal)', async () => {
      findUnique.mockResolvedValue({
        id: PEDIDO_ID,
        estado: 'PENDIENTE_PAGO',
        canal: 'WEB',
        pagos: [],
      });

      const r = await service.consultar(TENANT_ID, PEDIDO_ID);

      expect(r.tarjeta.disponible).toBe(true);
      expect(r.efectivo.disponible).toBe(false);
    });
  });

  describe('HU-037 (BL-207): rebaja de IVA de la Ley 17.934', () => {
    const pedidoCon = (
      canal: string,
      pagoDelPedido: Record<string, unknown>,
    ) => ({
      id: PEDIDO_ID,
      estado: 'RECIBIDO',
      canal,
      pagos: [pago({ monto: new Prisma.Decimal('1220'), ...pagoDelPedido })],
    });

    it.each(['QR', 'MOZO'])(
      'pago con tarjeta aprobado de un consumo en el local (%s): informa total, reducción de 9 puntos, neto y leyenda',
      async (canal) => {
        findUnique.mockResolvedValue(pedidoCon(canal, {}));

        const estado = await service.consultar(TENANT_ID, PEDIDO_ID);

        expect(estado.rebajaIva).toEqual({
          ley: '17.934',
          puntos: 9,
          totalSinReduccion: '1220.00',
          reduccion: '90.00',
          neto: '1130.00',
          leyenda: 'Reducción IVA Ley N° 17.934',
        });
      },
    );

    it.each([
      ['efectivo', 'QR', { medioPago: 'EFECTIVO' }],
      ['para retirar (Ley 19.210, no 17.934)', 'WEB', {}],
      ['pago rechazado', 'QR', { estado: 'RECHAZADO' }],
      ['pago pendiente', 'QR', { estado: 'PENDIENTE' }],
    ])('%s: sin rebaja', async (_caso, canal, pagoDelPedido) => {
      findUnique.mockResolvedValue(pedidoCon(canal, pagoDelPedido));

      const estado = await service.consultar(TENANT_ID, PEDIDO_ID);

      expect(estado.rebajaIva).toBeNull();
    });
  });
});
