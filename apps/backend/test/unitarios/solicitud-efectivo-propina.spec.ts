import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SolicitudEfectivoService } from '../../src/pagos/efectivo/solicitud-efectivo.service';

// HU-022 (BL-494, BL-85): el aviso de efectivo incluye la propina elegida.

const TENANT = '11111111-1111-1111-1111-111111111111';
const PEDIDO = '22222222-2222-4222-8222-222222222222';
const AHORA = new Date('2026-11-09T17:30:00.000Z');
const MESA = { id: 'mesa-3', numero: 3 };

// consumo $ 810
function pedido(overrides: Record<string, unknown> = {}) {
  return {
    canal: 'QR',
    estado: 'PENDIENTE_PAGO',
    efectivoSolicitadoEn: null,
    propinaPorcentaje: null,
    propinaMonto: null,
    mesa: MESA,
    lineas: [
      { subtotal: new Prisma.Decimal('560') },
      { subtotal: new Prisma.Decimal('250') },
    ],
    pagos: [],
    ...overrides,
  };
}

describe('SolicitudEfectivoService con propina (HU-022, BL-494)', () => {
  let tx: {
    pedido: { findUnique: jest.Mock; update: jest.Mock };
    restaurante: { findUnique: jest.Mock };
  };
  let pedidos: { notificarSolicitudEfectivo: jest.Mock };
  let service: SolicitudEfectivoService;

  function armar(datosPedido: Record<string, unknown>) {
    tx = {
      pedido: {
        findUnique: jest.fn().mockResolvedValue(datosPedido),
        update: jest.fn(),
      },
      restaurante: {
        findUnique: jest.fn().mockResolvedValue({ efectivoHabilitado: true }),
      },
    };
    const tenantPrisma = {
      runInTenantContext: jest.fn((_tenantId, callback) => callback(tx)),
    };
    pedidos = { notificarSolicitudEfectivo: jest.fn() };
    service = new SolicitudEfectivoService(tenantPrisma as any, pedidos as any);
  }

  it('sin propina elegida: el total es el consumo', async () => {
    armar(pedido());

    const r = await service.solicitar(TENANT, PEDIDO, {}, AHORA);

    expect(r.total).toBe('810.00');
  });

  it('con 15 %: 121,5 se redondea a 122 y el total, el aviso y la respuesta lo incluyen', async () => {
    armar(pedido({ propinaPorcentaje: 15 }));

    const r = await service.solicitar(
      TENANT,
      PEDIDO,
      { pagaCon: '1000' },
      AHORA,
    );

    expect(r.total).toBe('932.00');
    expect(pedidos.notificarSolicitudEfectivo).toHaveBeenCalledWith(
      TENANT,
      MESA,
      { pedidoId: PEDIDO, total: '932.00', pagaCon: '1000.00' },
    );
  });

  it('con monto libre de $ 100: el total es el consumo más 100', async () => {
    armar(pedido({ propinaMonto: 100 }));

    const r = await service.solicitar(TENANT, PEDIDO, {}, AHORA);

    expect(r.total).toBe('910.00');
  });

  it('«con cuánto» se compara contra el total con propina: menor, 400 y no guarda ni avisa', async () => {
    armar(pedido({ propinaPorcentaje: 15 }));

    await expect(
      service.solicitar(TENANT, PEDIDO, { pagaCon: '900' }, AHORA),
    ).rejects.toThrow(
      new BadRequestException(
        'El monto con el que vas a pagar ($ 900.00) es menor que el total ($ 932.00)',
      ),
    );
    expect(tx.pedido.update).not.toHaveBeenCalled();
    expect(pedidos.notificarSolicitudEfectivo).not.toHaveBeenCalled();
  });

  it('pagar justo con el total con propina se acepta', async () => {
    armar(pedido({ propinaPorcentaje: 15 }));

    await expect(
      service.solicitar(TENANT, PEDIDO, { pagaCon: '932' }, AHORA),
    ).resolves.toMatchObject({ total: '932.00', pagaCon: '932.00' });
  });
});
