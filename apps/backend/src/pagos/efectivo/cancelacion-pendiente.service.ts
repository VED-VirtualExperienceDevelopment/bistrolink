import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { PedidosService } from '../../pedidos/pedidos.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction } from '../../audit-log/audit-action.enum';

// usuario.keycloak_id es UUID: un actor que no lo es no tiene fila.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PendienteCancelado {
  pedidoId: string;
  estado: 'CANCELADO';
  /** Total con 2 decimales, como texto ("590.00"). */
  total: string;
}

/**
 * BL-501: el mozo o el administrador cancela un pedido que todavía espera el
 * pago (prepago, RD.03): el comensal se arrepintió o se cargó por error.
 *
 * - Solo pedidos en PENDIENTE_PAGO. Uno pagado se cancela con la devolución
 *   (HU-024, CancelacionPedidoService).
 * - Si el comensal tiene un pago con tarjeta en curso, 409: el pago se
 *   resuelve o vence solo, y recién ahí se puede cancelar.
 * - No hay nada que devolver ni stock que reponer: el stock se descuenta al
 *   confirmar el pago (ADR 0009) y el pedido nunca llegó a cocina.
 * - En una transacción: pedido a CANCELADO, historial con quién lo hizo y
 *   auditoría. Después se avisa al comensal y a las pantallas del personal.
 */
@Injectable()
export class CancelacionPendienteService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly pedidos: PedidosService,
    private readonly auditLog: AuditLogService,
  ) {}

  async cancelar(
    tenantId: string,
    actorKeycloakId: string,
    pedidoId: string,
  ): Promise<PendienteCancelado> {
    const cancelado = await this.tenantPrisma.runInTenantContext(
      tenantId,
      (tx) => this.cancelarEnTx(tx, tenantId, actorKeycloakId, pedidoId),
    );
    this.pedidos.notificarPendienteCancelado(tenantId, pedidoId);
    return cancelado;
  }

  private async cancelarEnTx(
    tx: PrismaClient,
    tenantId: string,
    actorKeycloakId: string,
    pedidoId: string,
  ): Promise<PendienteCancelado> {
    const pedido = await tx.pedido.findUnique({
      where: { id: pedidoId },
      select: {
        id: true,
        estado: true,
        canal: true,
        mesa: { select: { numero: true, esVirtual: true } },
        lineas: { select: { subtotal: true } },
        pagos: { where: { estado: 'PENDIENTE' }, select: { id: true } },
      },
    });
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }
    if (pedido.estado === 'CANCELADO') {
      throw new ConflictException('El pedido ya está cancelado');
    }
    if (pedido.estado !== 'PENDIENTE_PAGO') {
      throw new ConflictException(
        'Este pedido ya se cobró: se cancela con la devolución del pago',
      );
    }
    if (pedido.pagos.length > 0) {
      throw new ConflictException(
        'El comensal tiene un pago con tarjeta en curso para este pedido. Esperá a que termine: si no se confirma, vence solo en unos minutos.',
      );
    }

    // Solo si sigue sin pagar: un cobro que entró entre medio gana y esto
    // no cancela nada (updateMany bloquea la fila del pedido).
    const { count } = await tx.pedido.updateMany({
      where: { id: pedido.id, estado: 'PENDIENTE_PAGO' },
      data: { estado: 'CANCELADO' },
    });
    if (count === 0) {
      throw new ConflictException('Este pedido ya se cobró');
    }

    const usuario = UUID.test(actorKeycloakId)
      ? await tx.usuario.findUnique({
          where: { keycloakId: actorKeycloakId },
          select: { id: true },
        })
      : null;
    await tx.pedidoEstadoHistorial.create({
      data: {
        tenantId,
        pedidoId: pedido.id,
        usuarioId: usuario?.id ?? null,
        estadoAnterior: 'PENDIENTE_PAGO',
        estadoNuevo: 'CANCELADO',
      },
    });

    const total = pedido.lineas
      .reduce((suma, l) => suma.plus(l.subtotal), new Prisma.Decimal(0))
      .toFixed(2);
    await this.auditLog.registrarEnTx(tx, {
      action: AuditAction.PEDIDO_PENDIENTE_CANCELADO,
      tenantId,
      actorKeycloakId,
      entidadId: pedido.id,
      antes: { estado: 'PENDIENTE_PAGO' },
      despues: { estado: 'CANCELADO' },
      detalle: {
        total,
        canal: pedido.canal,
        mesa: pedido.mesa.esVirtual ? null : pedido.mesa.numero,
      },
    });

    return { pedidoId: pedido.id, estado: 'CANCELADO', total };
  }
}
