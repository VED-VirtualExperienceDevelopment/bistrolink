import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction } from '../../src/audit-log/audit-action.enum';
import { CancelacionPedidoService } from '../../src/pagos/cancelacion/cancelacion-pedido.service';
import { CancelarPedidoDto } from '../../src/pagos/cancelacion/cancelar-pedido.dto';
import * as colaKds from '../../src/pedidos/cola-kds';

// HU-022 (BL-494, BL-85): la cancelación devuelve todo lo cobrado, consumo y
// propina.

const TENANT = '11111111-1111-1111-1111-111111111111';
const PEDIDO = '22222222-2222-4222-8222-222222222222';
const ACTOR = '44444444-4444-4444-8444-444444444444';

// consumo $ 590 + propina $ 89 (15 %) = $ 679.
const pago = (extra: Record<string, unknown> = {}) => ({
  id: 'pago-mp',
  estado: 'APROBADO',
  medioPago: 'MERCADOPAGO',
  monto: new Prisma.Decimal('590.00'),
  propina: new Prisma.Decimal('89.00'),
  pasarelaReferencia: 'ORD1',
  ...extra,
});

const pagoEfectivo = (extra: Record<string, unknown> = {}) =>
  pago({
    id: 'pago-ef',
    medioPago: 'EFECTIVO',
    pasarelaReferencia: null,
    ...extra,
  });

describe('CancelacionPedidoService con propina (HU-022, BL-494)', () => {
  let tx: {
    pedido: { findUnique: jest.Mock; updateMany: jest.Mock };
    pago: { updateMany: jest.Mock };
    pagoEstadoHistorial: { create: jest.Mock };
    pedidoEstadoHistorial: { create: jest.Mock };
    usuario: { findUnique: jest.Mock };
  };
  let pedidos: {
    reponerStockEnTx: jest.Mock;
    notificarPedidoCancelado: jest.Mock;
  };
  let cfe: { emitirNotaDeCreditoEnSegundoPlano: jest.Mock };
  let auditLog: { registrarEnTx: jest.Mock };
  let mercadoPago: { reembolsarOrden: jest.Mock };
  let service: CancelacionPedidoService;

  const conPagos = (estado: string, pagos: unknown[]) =>
    tx.pedido.findUnique.mockImplementation(({ select }) =>
      Promise.resolve(
        select.pagos ? { id: PEDIDO, estado, pagos } : { estado },
      ),
    );

  const cancelar = (dto: Partial<CancelarPedidoDto> = {}) =>
    service.cancelar(TENANT, ACTOR, PEDIDO, {
      motivo: 'RECLAMO_CLIENTE',
      ...dto,
    } as CancelarPedidoDto);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(colaKds, 'completarCapacidad').mockResolvedValue([]);
    tx = {
      pedido: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pago: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      pagoEstadoHistorial: { create: jest.fn() },
      pedidoEstadoHistorial: { create: jest.fn() },
      usuario: { findUnique: jest.fn().mockResolvedValue({ id: 'u-mozo' }) },
    };
    conPagos('RECIBIDO', [pago()]);
    pedidos = {
      reponerStockEnTx: jest.fn().mockResolvedValue(['item-1']),
      notificarPedidoCancelado: jest.fn(),
    };
    cfe = { emitirNotaDeCreditoEnSegundoPlano: jest.fn() };
    auditLog = { registrarEnTx: jest.fn() };
    mercadoPago = { reembolsarOrden: jest.fn().mockResolvedValue(undefined) };
    service = new CancelacionPedidoService(
      { runInTenantContext: jest.fn((_t, cb) => cb(tx)) } as any,
      pedidos as any,
      cfe as any,
      auditLog as any,
      mercadoPago as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('lee la propina de los pagos', async () => {
    await service.vistaPrevia(TENANT, PEDIDO);

    const { select } = tx.pedido.findUnique.mock.calls[0][0];
    expect(select.pagos.select.propina).toBe(true);
  });

  it('la vista previa informa el total con propina, en el pedido y en cada devolución', async () => {
    await expect(service.vistaPrevia(TENANT, PEDIDO)).resolves.toMatchObject({
      monto: '679.00',
      devoluciones: [
        {
          pagoId: 'pago-mp',
          medio: 'MERCADOPAGO',
          monto: '679.00',
          automatica: true,
        },
      ],
    });
  });

  it('suma varios pagos: cada uno con su propina', async () => {
    conPagos('RECIBIDO', [
      pago(),
      pagoEfectivo({ propina: new Prisma.Decimal('0.00') }),
    ]);

    await expect(service.vistaPrevia(TENANT, PEDIDO)).resolves.toMatchObject({
      monto: '1269.00',
    });
  });

  describe('Mercado Pago', () => {
    it('reembolsa la order completa una sola vez y devuelve el total con propina', async () => {
      const resultado = await cancelar();

      expect(mercadoPago.reembolsarOrden).toHaveBeenCalledTimes(1);
      expect(mercadoPago.reembolsarOrden).toHaveBeenCalledWith(
        'ORD1',
        TENANT,
        'reembolso-pago-mp',
      );
      expect(resultado).toMatchObject({
        monto: '679.00',
        devoluciones: [{ pagoId: 'pago-mp', monto: '679.00' }],
      });
    });

    it('la auditoría deja el total devuelto y cuánto fue propina', async () => {
      await cancelar({ motivo: 'OTRO', detalle: 'Se fue sin esperar' });

      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
        action: AuditAction.PEDIDO_CANCELADO,
        tenantId: TENANT,
        actorKeycloakId: ACTOR,
        entidadId: PEDIDO,
        despues: {
          motivo: 'Otro',
          monto: '679.00',
          propina: '89.00',
          devolucion: 'Mercado Pago (reembolso automático)',
          stockRepuesto: true,
        },
        detalle: {
          motivo: 'OTRO',
          detalle: 'Se fue sin esperar',
          estadoPrevio: 'RECIBIDO',
          pagos: ['pago-mp'],
        },
      });
    });

    it('la nota de crédito se pide por el pago, que sigue facturado por el consumo', async () => {
      await cancelar();

      expect(cfe.emitirNotaDeCreditoEnSegundoPlano).toHaveBeenCalledWith(
        TENANT,
        'pago-mp',
      );
    });
  });

  describe('efectivo (devolución manual)', () => {
    beforeEach(() => conPagos('EN_PREPARACION', [pagoEfectivo()]));

    it('el mozo ve cuánto devolver: el consumo más la propina', async () => {
      await expect(service.vistaPrevia(TENANT, PEDIDO)).resolves.toMatchObject({
        monto: '679.00',
        devoluciones: [
          { pagoId: 'pago-ef', monto: '679.00', automatica: false },
        ],
      });
    });

    it('cancela, devuelve el total con propina y lo deja en la auditoría', async () => {
      const resultado = await cancelar({ devolucionManualConfirmada: true });

      expect(resultado.monto).toBe('679.00');
      expect(mercadoPago.reembolsarOrden).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx.mock.calls[0][1].despues).toMatchObject({
        monto: '679.00',
        propina: '89.00',
        devolucion: 'Efectivo (devolución manual)',
      });
    });
  });

  describe('sin propina', () => {
    beforeEach(() =>
      conPagos('RECIBIDO', [pago({ propina: new Prisma.Decimal('0.00') })]),
    );

    it('devuelve solo el consumo', async () => {
      await expect(cancelar()).resolves.toMatchObject({ monto: '590.00' });
    });

    it('la auditoría no lleva el campo propina', async () => {
      await cancelar();

      expect(auditLog.registrarEnTx.mock.calls[0][1].despues).toEqual({
        motivo: 'Reclamo del cliente',
        monto: '590.00',
        devolucion: 'Mercado Pago (reembolso automático)',
        stockRepuesto: true,
      });
    });
  });
});
