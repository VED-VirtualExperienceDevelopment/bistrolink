import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import {
  MercadoPagoGateway,
  OrdenConsultada,
} from '../gateways/mercadopago.gateway';
import { leerReferenciaExterna } from './referencia-externa';

// TODO(Plexo): este servicio y la verificación de firma son específicos de
// Mercado Pago. Cuando lleguen las credenciales de Plexo y se conozca su
// formato real de notificación, generalizar la interfaz PagoGateway con
// verificarFirma()/consultarEstado() en vez de duplicar este servicio.git status

type EstadoPago = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'REEMBOLSADO';

export type ResultadoWebhook =
  | 'actualizado'
  | 'sin_cambios'
  | 'sin_resolver'
  | 'orden_desconocida'
  | 'referencia_ajena'
  | 'pago_no_encontrado'
  | 'monto_no_coincide';

// Estado real del pago según la order que devuelve Mercado Pago.
export function estadoPagoDesdeOrden(
  status?: string,
  statusDetail?: string,
): EstadoPago {
  if (status === 'processed' && statusDetail === 'accredited') {
    return 'APROBADO';
  }
  if (status === 'refunded') {
    return 'REEMBOLSADO';
  }
  if (['failed', 'canceled', 'expired'].includes(status ?? '')) {
    return 'RECHAZADO';
  }
  return 'PENDIENTE'; // processing, action_required, o algo que no conocemos
}

@Injectable()
export class PagosWebhookService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly mercadoPago: MercadoPagoGateway,
  ) {}

  // BL-78: la notificación solo avisa que algo cambió. Se consulta la order
  // a Mercado Pago (fuente de verdad) y se refleja en nuestro Pago y la mesa.
  // Es idempotente: Mercado Pago reintenta hasta recibir un 200, y siempre
  // se lee el estado ACTUAL, así que una notificación duplicada o desordenada
  // no puede dejar un estado viejo.
  async procesarOrden(orderId: string): Promise<ResultadoWebhook> {
    const orden = await this.mercadoPago.consultarOrden(orderId);
    if (!orden) {
      Logger.warn(
        `Webhook: la order ${orderId} no existe en Mercado Pago`,
        PagosWebhookService.name,
      );
      return 'orden_desconocida';
    }

    // Solo nos interesan las orders creadas por nosotros: son las que
    // llevan el tenant y el pedido en el external_reference.
    const referencia = leerReferenciaExterna(orden.externalReference);
    if (!referencia) {
      Logger.warn(
        `Webhook: la order ${orden.id} no tiene una referencia de BistroLink`,
        PagosWebhookService.name,
      );
      return 'referencia_ajena';
    }

    const estado = estadoPagoDesdeOrden(orden.status, orden.statusDetail);
    if (estado === 'PENDIENTE') {
      return 'sin_resolver';
    }

    // Siempre dentro del contexto del tenant de la referencia (RLS): nunca
    // se consulta entre restaurantes.
    return this.tenantPrisma.runInTenantContext(referencia.tenantId, (tx) =>
      this.aplicar(tx, orden, referencia.pedidoId, estado),
    );
  }

  private async aplicar(
    tx: PrismaClient,
    orden: OrdenConsultada,
    pedidoId: string,
    estado: EstadoPago,
  ): Promise<ResultadoWebhook> {
    const candidatos = await tx.pago.findMany({
      where: { pedidoId, medioPago: 'MERCADOPAGO' },
    });
    // El webhook puede llegar antes de que la respuesta del cobro guarde la
    // referencia: en ese caso el pago es el PENDIENTE que todavía no la tiene.
    const pago =
      candidatos.find((p) => p.pasarelaReferencia === orden.id) ??
      candidatos.find((p) => p.estado === 'PENDIENTE' && !p.pasarelaReferencia);

    if (!pago) {
      Logger.warn(
        `Webhook: no hay un Pago de Mercado Pago para la order ${orden.id}`,
        PagosWebhookService.name,
      );
      return 'pago_no_encontrado';
    }

    // Defensa: nunca se da por resuelto un pago cuyo monto no coincide.
    if (
      orden.totalAmount === undefined ||
      !new Prisma.Decimal(orden.totalAmount).equals(pago.monto)
    ) {
      Logger.error(
        `Webhook: el monto de la order ${orden.id} (${orden.totalAmount}) no coincide con el del pago ${pago.id} (${pago.monto})`,
        undefined,
        PagosWebhookService.name,
      );
      return 'monto_no_coincide';
    }

    if (pago.estado === estado && pago.pasarelaReferencia === orden.id) {
      return 'sin_cambios';
    }

    await tx.pago.update({
      where: { id: pago.id },
      data: { estado, pasarelaReferencia: orden.id },
    });

    // La mesa solo se toca si sigue EN_PROCESO_DE_PAGO: una notificación
    // tardía no debe liberar ni ocupar una mesa que ya siguió su curso.
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
