import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SolicitudPago } from '../../src/pagos/dto/crear-pago.dto';
import { PagosService } from '../../src/pagos/pagos.service';

// HU-022 (BL-494, BL-85): el cobro con tarjeta suma la propina al consumo.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const PAGO_ID = 'a4a91b9c-a546-4b7a-be01-cd8861294bae';

const DTO: SolicitudPago = {
  pedidoId: PEDIDO_ID,
  idempotencyKey: 'pago-propina-001',
  medioPago: 'MERCADOPAGO',
  datosPasarela: { token: 'tok', paymentMethodId: 'master' },
};

// consumo $ 1.250
function pedido(overrides: Record<string, unknown> = {}) {
  return {
    id: PEDIDO_ID,
    mesaId: MESA_ID,
    lineas: [
      { subtotal: new Prisma.Decimal('800') },
      { subtotal: new Prisma.Decimal('450') },
    ],
    propinaPorcentaje: null,
    propinaMonto: null,
    ...overrides,
  };
}

function crearTx(datosPedido: Record<string, unknown>) {
  const pagos = new Map<string, any>();
  return {
    pago: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }) => {
        const pago = { id: PAGO_ID, pasarelaReferencia: null, ...data };
        pagos.set(pago.id, pago);
        return pago;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const pago = pagos.get(where.id);
        if (!pago || (where.estado && pago.estado !== where.estado)) {
          return { count: 0 };
        }
        Object.assign(pago, data);
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn(async ({ where }) => ({
        ...pagos.get(where.id),
      })),
    },
    pedido: {
      findUnique: jest.fn().mockResolvedValue(datosPedido),
      update: jest.fn(),
    },
    mesa: {
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    pagoEstadoHistorial: { create: jest.fn() },
    restaurante: {
      findUnique: jest.fn().mockResolvedValue({
        mercadoPagoHabilitado: true,
        plexoHabilitado: true,
      }),
    },
  };
}

describe('PagosService.crear con propina (HU-022, BL-494)', () => {
  let tx: ReturnType<typeof crearTx>;
  let gateway: { cobrar: jest.Mock };
  let service: PagosService;

  function armar(datosPedido: Record<string, unknown>) {
    tx = crearTx(datosPedido);
    const tenantPrisma = {
      runInTenantContext: jest.fn((_tenantId, callback) => callback(tx)),
    };
    gateway = {
      cobrar: jest
        .fn()
        .mockResolvedValue({ aprobado: true, pasarelaReferencia: 'ORD1' }),
    };
    const gatewayFactory = { obtener: jest.fn().mockReturnValue(gateway) };
    const cfe = { emitirEnSegundoPlano: jest.fn() };
    const pedidos = {
      confirmarPagoEnTx: jest.fn().mockResolvedValue({
        id: PEDIDO_ID,
        estado: 'RECIBIDO',
        createdAt: new Date('2026-11-09T12:00:00.000Z'),
        observacionGeneral: null,
        mesa: { numero: 4 },
        lineas: [],
      }),
      verificarStockEnTx: jest.fn().mockResolvedValue(undefined),
      notificarPedidoConfirmado: jest.fn(),
      notificarEstadoMesa: jest.fn(),
    };
    service = new PagosService(
      tenantPrisma as any,
      gatewayFactory as any,
      cfe as any,
      pedidos as any,
    );
  }

  it('sin propina elegida: se cobra el consumo y el pago guarda propina 0', async () => {
    armar(pedido());

    await service.crear(TENANT_ID, DTO);

    const data = tx.pago.create.mock.calls[0][0].data;
    expect(data.monto.toString()).toBe('1250');
    expect(data.propina.toString()).toBe('0');
    expect(gateway.cobrar.mock.calls[0][0].monto.toString()).toBe('1250');
  });

  it('con 15 %: el monto sigue siendo el consumo, la propina va aparte y a la pasarela viaja el total', async () => {
    armar(pedido({ propinaPorcentaje: 15 }));

    await service.crear(TENANT_ID, DTO);

    const data = tx.pago.create.mock.calls[0][0].data;
    expect(data.monto.toString()).toBe('1250');
    expect(data.propina.toString()).toBe('188');
    expect(gateway.cobrar.mock.calls[0][0].monto.toString()).toBe('1438');
  });

  it('con monto libre de $ 200: a la pasarela viaja consumo + 200', async () => {
    armar(pedido({ propinaMonto: 200 }));

    await service.crear(TENANT_ID, DTO);

    const data = tx.pago.create.mock.calls[0][0].data;
    expect(data.propina.toString()).toBe('200');
    expect(gateway.cobrar.mock.calls[0][0].monto.toString()).toBe('1450');
  });

  it('el pago devuelto conserva el consumo en monto y la propina aparte', async () => {
    armar(pedido({ propinaPorcentaje: 10 }));

    const pago: any = await service.crear(TENANT_ID, DTO);

    expect(pago.estado).toBe('APROBADO');
    expect(pago.monto.toString()).toBe('1250');
    expect(pago.propina.toString()).toBe('125');
  });

  it('pedido sin consumo: 400 aunque haya propina elegida, y no se cobra', async () => {
    armar(pedido({ lineas: [], propinaMonto: 100 }));

    await expect(service.crear(TENANT_ID, DTO)).rejects.toThrow(
      BadRequestException,
    );
    expect(tx.pago.create).not.toHaveBeenCalled();
    expect(gateway.cobrar).not.toHaveBeenCalled();
  });
});
