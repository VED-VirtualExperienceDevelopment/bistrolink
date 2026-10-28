import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ESPERA_ENTRE_AVISOS_MS,
  SolicitudEfectivoService,
} from '../../src/pagos/efectivo/solicitud-efectivo.service';
import { SolicitarEfectivoDto } from '../../src/pagos/efectivo/solicitar-efectivo.dto';

// HU-031b (BL-442): el comensal de una mesa pide pagar en efectivo.

const TENANT = '11111111-1111-1111-1111-111111111111';
const PEDIDO = '22222222-2222-4222-8222-222222222222';
const AHORA = new Date('2026-10-28T17:30:00.000Z');
const MESA = { id: 'mesa-3', numero: 3 };

function pedido(overrides: Record<string, unknown> = {}) {
  return {
    canal: 'QR',
    estado: 'PENDIENTE_PAGO',
    efectivoSolicitadoEn: null,
    mesa: MESA,
    lineas: [
      { subtotal: new Prisma.Decimal('560') },
      { subtotal: new Prisma.Decimal('250') },
    ],
    pagos: [],
    ...overrides,
  };
}

describe('SolicitudEfectivoService (HU-031b, BL-442)', () => {
  let tx: {
    pedido: { findUnique: jest.Mock; update: jest.Mock };
    restaurante: { findUnique: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let pedidos: { notificarSolicitudEfectivo: jest.Mock };
  let service: SolicitudEfectivoService;

  beforeEach(() => {
    tx = {
      pedido: {
        findUnique: jest.fn().mockResolvedValue(pedido()),
        update: jest.fn(),
      },
      restaurante: {
        findUnique: jest.fn().mockResolvedValue({ efectivoHabilitado: true }),
      },
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_tenantId, callback) => callback(tx)),
    };
    pedidos = { notificarSolicitudEfectivo: jest.fn() };
    service = new SolicitudEfectivoService(tenantPrisma as any, pedidos as any);
  });

  const solicitar = (dto: SolicitarEfectivoDto = {}, ahora = AHORA) =>
    service.solicitar(TENANT, PEDIDO, dto, ahora);

  it('guarda la solicitud en el pedido, dentro del tenant (RLS)', async () => {
    await solicitar({ pagaCon: '1000' });

    expect(tenantPrisma.runInTenantContext).toHaveBeenCalledWith(
      TENANT,
      expect.any(Function),
    );
    expect(tx.pedido.update).toHaveBeenCalledWith({
      where: { id: PEDIDO },
      data: {
        efectivoSolicitadoEn: AHORA,
        efectivoPagaCon: new Prisma.Decimal('1000'),
      },
    });
  });

  it('avisa al staff con la mesa, el total y con cuánto paga, después de guardar', async () => {
    const r = await solicitar({ pagaCon: '1000' });

    expect(pedidos.notificarSolicitudEfectivo).toHaveBeenCalledWith(
      TENANT,
      MESA,
      { pedidoId: PEDIDO, total: '810.00', pagaCon: '1000.00' },
    );
    expect(r).toEqual({
      pedidoId: PEDIDO,
      total: '810.00',
      pagaCon: '1000.00',
      solicitadoEn: AHORA,
      avisado: true,
    });
  });

  it('sin «con cuánto»: se avisa igual, con pagaCon null', async () => {
    const r = await solicitar();

    expect(r.pagaCon).toBeNull();
    expect(tx.pedido.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { efectivoSolicitadoEn: AHORA, efectivoPagaCon: null },
      }),
    );
    expect(pedidos.notificarSolicitudEfectivo).toHaveBeenCalled();
  });

  it('paga justo con el total: se acepta', async () => {
    await expect(solicitar({ pagaCon: '810' })).resolves.toMatchObject({
      pagaCon: '810.00',
    });
  });

  it('«con cuánto» menor que el total: 400 y no guarda ni avisa', async () => {
    await expect(solicitar({ pagaCon: '500' })).rejects.toThrow(
      new BadRequestException(
        'El monto con el que vas a pagar ($ 500.00) es menor que el total ($ 810.00)',
      ),
    );
    expect(tx.pedido.update).not.toHaveBeenCalled();
    expect(pedidos.notificarSolicitudEfectivo).not.toHaveBeenCalled();
  });

  it('pedido para retirar (fuera del local): 409, solo tarjeta', async () => {
    tx.pedido.findUnique.mockResolvedValue(pedido({ canal: 'WEB' }));

    await expect(solicitar()).rejects.toThrow(
      new ConflictException(
        'El pago en efectivo es solo para pedidos hechos en el local. Pagá con tarjeta.',
      ),
    );
    expect(tx.pedido.update).not.toHaveBeenCalled();
    expect(pedidos.notificarSolicitudEfectivo).not.toHaveBeenCalled();
  });

  it('local sin efectivo habilitado: 409', async () => {
    tx.restaurante.findUnique.mockResolvedValue({ efectivoHabilitado: false });

    await expect(solicitar()).rejects.toThrow(
      new ConflictException(
        'Este local no acepta pagos en efectivo. Pagá con tarjeta.',
      ),
    );
    expect(tx.pedido.update).not.toHaveBeenCalled();
  });

  it('sin restaurante (no debería pasar): se trata como deshabilitado', async () => {
    tx.restaurante.findUnique.mockResolvedValue(null);

    await expect(solicitar()).rejects.toThrow(ConflictException);
  });

  it('pedido inexistente en el tenant: 404', async () => {
    tx.pedido.findUnique.mockResolvedValue(null);

    await expect(solicitar()).rejects.toThrow(NotFoundException);
  });

  it.each([
    ['RECIBIDO', 'Este pedido ya fue pagado'],
    ['CANCELADO', 'El pedido está cancelado'],
  ])('pedido en %s: 409 «%s»', async (estado, mensaje) => {
    tx.pedido.findUnique.mockResolvedValue(pedido({ estado }));

    await expect(solicitar()).rejects.toThrow(new ConflictException(mensaje));
  });

  it('con un pago con tarjeta en curso: 409', async () => {
    tx.pedido.findUnique.mockResolvedValue(
      pedido({ pagos: [{ id: 'pago-mp' }] }),
    );

    await expect(solicitar()).rejects.toThrow(
      new ConflictException(
        'Ya hay un pago con tarjeta en curso para este pedido.',
      ),
    );
  });

  describe('un aviso por minuto (como «Llamar al mozo»)', () => {
    it('si ya avisó hace menos de un minuto: guarda lo nuevo pero no vuelve a avisar', async () => {
      const antes = new Date(AHORA.getTime() - 30_000);
      tx.pedido.findUnique.mockResolvedValue(
        pedido({ efectivoSolicitadoEn: antes }),
      );

      const r = await solicitar({ pagaCon: '2000' });

      expect(r).toMatchObject({ avisado: false, solicitadoEn: antes });
      expect(tx.pedido.update).toHaveBeenCalledWith({
        where: { id: PEDIDO },
        data: {
          efectivoSolicitadoEn: antes,
          efectivoPagaCon: new Prisma.Decimal('2000'),
        },
      });
      expect(pedidos.notificarSolicitudEfectivo).not.toHaveBeenCalled();
    });

    it('pasado el minuto: vuelve a avisar', async () => {
      const antes = new Date(AHORA.getTime() - ESPERA_ENTRE_AVISOS_MS);
      tx.pedido.findUnique.mockResolvedValue(
        pedido({ efectivoSolicitadoEn: antes }),
      );

      const r = await solicitar();

      expect(r).toMatchObject({ avisado: true, solicitadoEn: AHORA });
      expect(pedidos.notificarSolicitudEfectivo).toHaveBeenCalled();
    });
  });

  it('usa la hora actual si no se la pasan', async () => {
    const r = await service.solicitar(TENANT, PEDIDO, {});

    expect(r.solicitadoEn).toBeInstanceOf(Date);
  });
});

describe('SolicitarEfectivoDto (HU-031b, BL-442)', () => {
  const errores = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(SolicitarEfectivoDto, body))).map(
      (e) => e.property,
    );

  it.each([[{}], [{ pagaCon: '1000' }], [{ pagaCon: '1000.50' }]])(
    'acepta %p',
    async (body) => {
      expect(await errores(body)).toEqual([]);
    },
  );

  it.each([['-1'], ['10.123'], ['mil'], ['']])(
    'rechaza pagaCon %p',
    async (pagaCon) => {
      expect(await errores({ pagaCon })).toEqual(['pagaCon']);
    },
  );
});
