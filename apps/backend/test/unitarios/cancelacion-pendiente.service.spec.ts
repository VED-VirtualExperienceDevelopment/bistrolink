import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CancelacionPendienteService } from '../../src/pagos/efectivo/cancelacion-pendiente.service';
import { AuditAction } from '../../src/audit-log/audit-action.enum';

// BL-501: el mozo o el administrador cancela un pedido que todavía no se
// cobró.

const TENANT = '11111111-1111-4111-8111-111111111111';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const PEDIDO = '44444444-4444-4444-8444-444444444444';

function pedido(extra: Record<string, unknown> = {}) {
  return {
    id: PEDIDO,
    estado: 'PENDIENTE_PAGO',
    canal: 'MOZO',
    mesa: { numero: 3, esVirtual: false },
    lineas: [
      { subtotal: new Prisma.Decimal('590.00') },
      { subtotal: new Prisma.Decimal('590.00') },
    ],
    pagos: [],
    ...extra,
  };
}

describe('CancelacionPendienteService (BL-501)', () => {
  let tx: {
    pedido: { findUnique: jest.Mock; updateMany: jest.Mock };
    usuario: { findUnique: jest.Mock };
    pedidoEstadoHistorial: { create: jest.Mock };
  };
  let pedidos: { notificarPendienteCancelado: jest.Mock };
  let auditLog: { registrarEnTx: jest.Mock };
  let service: CancelacionPendienteService;

  beforeEach(() => {
    tx = {
      pedido: {
        findUnique: jest.fn().mockResolvedValue(pedido()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      usuario: { findUnique: jest.fn().mockResolvedValue({ id: 'u-1' }) },
      pedidoEstadoHistorial: { create: jest.fn().mockResolvedValue({}) },
    };
    pedidos = { notificarPendienteCancelado: jest.fn() };
    auditLog = { registrarEnTx: jest.fn().mockResolvedValue(undefined) };
    const tenantPrisma = {
      runInTenantContext: jest.fn((_t: string, fn: (t: unknown) => unknown) =>
        fn(tx),
      ),
    };
    service = new CancelacionPendienteService(
      tenantPrisma as any,
      pedidos as any,
      auditLog as any,
    );
  });

  it('cancela el pedido sin pagar: estado, historial con el usuario, auditoría y aviso', async () => {
    await expect(service.cancelar(TENANT, ACTOR, PEDIDO)).resolves.toEqual({
      pedidoId: PEDIDO,
      estado: 'CANCELADO',
      total: '1180.00',
    });

    expect(tx.pedido.updateMany).toHaveBeenCalledWith({
      where: { id: PEDIDO, estado: 'PENDIENTE_PAGO' },
      data: { estado: 'CANCELADO' },
    });
    expect(tx.pedidoEstadoHistorial.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT,
        pedidoId: PEDIDO,
        usuarioId: 'u-1',
        estadoAnterior: 'PENDIENTE_PAGO',
        estadoNuevo: 'CANCELADO',
      },
    });
    expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
      action: AuditAction.PEDIDO_PENDIENTE_CANCELADO,
      tenantId: TENANT,
      actorKeycloakId: ACTOR,
      entidadId: PEDIDO,
      antes: { estado: 'PENDIENTE_PAGO' },
      despues: { estado: 'CANCELADO' },
      detalle: { total: '1180.00', canal: 'MOZO', mesa: 3 },
    });
    expect(pedidos.notificarPendienteCancelado).toHaveBeenCalledWith(
      TENANT,
      PEDIDO,
    );
  });

  it('un pedido para retirar no tiene mesa; un actor que no es UUID no busca usuario', async () => {
    tx.pedido.findUnique.mockResolvedValue(
      pedido({ canal: 'QR', mesa: { numero: 0, esVirtual: true } }),
    );

    await service.cancelar(TENANT, 'script:limpieza', PEDIDO);

    expect(tx.usuario.findUnique).not.toHaveBeenCalled();
    expect(
      tx.pedidoEstadoHistorial.create.mock.calls[0][0].data.usuarioId,
    ).toBe(null);
    expect(auditLog.registrarEnTx.mock.calls[0][1].detalle).toEqual({
      total: '1180.00',
      canal: 'QR',
      mesa: null,
    });
  });

  it('un usuario sin fila deja el historial sin usuario', async () => {
    tx.usuario.findUnique.mockResolvedValue(null);
    await service.cancelar(TENANT, ACTOR, PEDIDO);
    expect(
      tx.pedidoEstadoHistorial.create.mock.calls[0][0].data.usuarioId,
    ).toBe(null);
  });

  it.each([
    [
      'no existe (u otro tenant, RLS)',
      null,
      NotFoundException,
      'Pedido no encontrado',
    ],
    [
      'ya está cancelado',
      pedido({ estado: 'CANCELADO' }),
      ConflictException,
      'El pedido ya está cancelado',
    ],
    [
      'ya se cobró',
      pedido({ estado: 'RECIBIDO' }),
      ConflictException,
      'Este pedido ya se cobró: se cancela con la devolución del pago',
    ],
    [
      'tiene un pago con tarjeta en curso',
      pedido({ pagos: [{ id: 'pago-1' }] }),
      ConflictException,
      'El comensal tiene un pago con tarjeta en curso',
    ],
  ])('%s: no cancela', async (_caso, encontrado, tipo, mensaje) => {
    tx.pedido.findUnique.mockResolvedValue(encontrado);

    const intento = service.cancelar(TENANT, ACTOR, PEDIDO);
    await expect(intento).rejects.toBeInstanceOf(tipo);
    await expect(intento).rejects.toThrow(mensaje);
    expect(tx.pedido.updateMany).not.toHaveBeenCalled();
    expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
    expect(pedidos.notificarPendienteCancelado).not.toHaveBeenCalled();
  });

  it('si un cobro entró entre medio, 409 y no deja historial ni auditoría', async () => {
    tx.pedido.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.cancelar(TENANT, ACTOR, PEDIDO)).rejects.toThrow(
      new ConflictException('Este pedido ya se cobró'),
    );
    expect(tx.pedidoEstadoHistorial.create).not.toHaveBeenCalled();
    expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
    expect(pedidos.notificarPendienteCancelado).not.toHaveBeenCalled();
  });
});
