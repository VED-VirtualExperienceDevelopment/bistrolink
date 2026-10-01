import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { PlexoGateway } from '../gateways/plexo.gateway';
import { leerReferenciaExterna } from './referencia-externa';

type EstadoPago = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'REEMBOLSADO';

export type ResultadoWebhookPlexo =
  | 'actualizado'
  | 'sin_cambios'
  | 'sin_resolver'
  | 'pago_desconocido'
  | 'referencia_ajena'
  | 'pago_no_encontrado'
  | 'monto_no_coincide';

export function estadoPagoDesdePlexo(status?: string): EstadoPago {
  if (status === 'approved') return 'APROBADO';
  if (status === 'denied') return 'RECHAZADO';
  return 'PENDIENTE';
}

@Injectable()
export class PlexoWebhookService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly plexo: PlexoGateway,
  ) {}

  async procesarPago(paymentId: string): Promise<ResultadoWebhookPlexo> {
    const pago = await this.plexo.consultarPago(paymentId);
    if (!pago) {
      Logger.warn(
        `Webhook Plexo: el pago ${paymentId} no existe en Plexo`,
        PlexoWebhookService.name,
      );
      return 'pago_desconocido';
    }

    const referencia = leerReferenciaExterna(pago.referenceId);
    if (!referencia) {
      Logger.warn(
        `Webhook Plexo: el pago ${pago.id} no tiene una referencia de BistroLink`,
        PlexoWebhookService.name,
      );
      return 'referencia_ajena';
    }

    const estado = estadoPagoDesdePlexo(pago.status);
    if (estado === 'PENDIENTE') {
      return 'sin_resolver';
    }

    return this.tenantPrisma.runInTenantContext(referencia.tenantId, (tx) =>
      this.aplicar(tx, pago, referencia.pedidoId, estado),
    );
  }

  private async aplicar(
    tx: PrismaClient,
    pago: { id: string; totalAmount?: number },
    pedidoId: string,
    estado: EstadoPago,
  ): Promise<ResultadoWebhookPlexo> {
    const candidatos = await tx.pago.findMany({
      where: { pedidoId, medioPago: 'PLEXO' },
    });
    // Al cobrar se guarda el id de la SESIÓN de checkout; el callback trae el
    // id del PAGO, que puede ser otro. Si no coincide por id, el pago es el
    // PENDIENTE de este pedido (el tenant y el pedido ya vienen verificados
    // en el referenceId y el monto se valida abajo).
    const pagoBd =
      candidatos.find((p) => p.pasarelaReferencia === pago.id) ??
      candidatos.find((p) => p.estado === 'PENDIENTE');

    if (!pagoBd) {
      Logger.warn(
        `Webhook Plexo: no hay un Pago de Plexo para ${pago.id}`,
        PlexoWebhookService.name,
      );
      return 'pago_no_encontrado';
    }

    if (
      pago.totalAmount === undefined ||
      !new Prisma.Decimal(pago.totalAmount).equals(pagoBd.monto)
    ) {
      Logger.error(
        `Webhook Plexo: el monto de ${pago.id} (${pago.totalAmount}) no coincide con el del pago ${pagoBd.id} (${pagoBd.monto})`,
        undefined,
        PlexoWebhookService.name,
      );
      return 'monto_no_coincide';
    }

    if (pagoBd.estado === estado && pagoBd.pasarelaReferencia === pago.id) {
      return 'sin_cambios';
    }

    await tx.pago.update({
      where: { id: pagoBd.id },
      data: { estado, pasarelaReferencia: pago.id },
    });

    if (estado === 'APROBADO' || estado === 'RECHAZADO') {
      const pedido = await tx.pedido.findUnique({
        where: { id: pedidoId },
        select: { mesaId: true },
      });
      if (pedido) {
        await tx.mesa.updateMany({
          where: { id: pedido.mesaId, estado: 'EN_PROCESO_DE_PAGO' },
          data: { estado: estado === 'APROBADO' ? 'LIBRE' : 'OCUPADA' },
        });
      }
    }

    return 'actualizado';
  }
}
