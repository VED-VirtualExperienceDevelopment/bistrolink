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
    comprobantes: [],
    ...overrides,
  };
}

describe('PagosService.consultar (BL-311: estado del pago y comprobante para el comensal)', () => {
  let findUnique: jest.Mock;
  let runInTenantContext: jest.Mock;
  let service: PagosService;

  beforeEach(() => {
    findUnique = jest.fn();
    runInTenantContext = jest.fn((_tenantId, fn) =>
      fn({ pedido: { findUnique } }),
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
        serie: 'A',
        numero: 1234,
        urlConsulta: 'https://www.efactura.dgi.gub.uy/consultaQR/x',
      },
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
          comprobantes: [{ serie: 'A', numero: 1, urlConsulta: null }],
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
    expect(Object.keys(r.comprobante!).sort()).toEqual([
      'numero',
      'serie',
      'urlConsulta',
    ]);
    // La consulta ni siquiera pide esos campos a la base.
    const { select } = findUnique.mock.calls[0][0];
    expect(select.pagos.select).not.toHaveProperty('pasarelaReferencia');
    expect(select.pagos.select.comprobantes.select).toEqual({
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
});
