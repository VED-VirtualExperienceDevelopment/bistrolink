import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { PlexoGateway } from '../gateways/plexo.gateway';
import { leerReferenciaExterna } from './referencia-externa';
import { CfeService } from '../../cfe/cfe.service';

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
    private readonly cfe: CfeService,
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
      // pending/authorized son estados esperados que todavía no son finales.
      // Cualquier otro valor es uno que no conocemos (ej. Plexo mandando
      // "declined" en vez de "denied"): el pago queda PENDIENTE, así que al
      // menos tiene que quedar rastro en los logs para detectarlo.
      if (!['pending', 'authorized'].includes(pago.status)) {
        Logger.warn(
          `Webhook Plexo: el pago ${pago.id} llegó con un status desconocido ("${pago.status}"), queda PENDIENTE`,
          PlexoWebhookService.name,
        );
      }
      return 'sin_resolver';
    }

    const { resultado, pagoId } = await this.tenantPrisma.runInTenantContext(
      referencia.tenantId,
      (tx) => this.aplicar(tx, pago, referencia.pedidoId, estado),
    );

    // Pago aprobado: se emite el CFE en segundo plano (ver PagosWebhookService).
    if (
      estado === 'APROBADO' &&
      pagoId &&
      (resultado === 'actualizado' || resultado === 'sin_cambios')
    ) {
      void this.cfe.intentarEmitir(referencia.tenantId, pagoId);
    }
    return resultado;
  }

  private async aplicar(
    tx: PrismaClient,
    pago: { id: string; totalAmount?: number },
    pedidoId: string,
    estado: EstadoPago,
  ): Promise<{ resultado: ResultadoWebhookPlexo; pagoId?: string }> {
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
      return { resultado: 'pago_no_encontrado' };
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
      return { resultado: 'monto_no_coincide' };
    }

    if (pagoBd.estado === estado && pagoBd.pasarelaReferencia === pago.id) {
      return { resultado: 'sin_cambios', pagoId: pagoBd.id };
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

    return { resultado: 'actualizado', pagoId: pagoBd.id };
  }
}
