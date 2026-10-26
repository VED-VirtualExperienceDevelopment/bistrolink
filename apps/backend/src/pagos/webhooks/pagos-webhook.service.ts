import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import {
  MercadoPagoGateway,
  OrdenConsultada,
} from '../gateways/mercadopago.gateway';
import { leerReferenciaExterna } from './referencia-externa';
import { CfeService } from '../../cfe/cfe.service';
import { PedidosService } from '../../pedidos/pedidos.service';
import { PedidoParaKds } from '../../pedidos/pedido-kds.mapper';
import {
  DETALLE_REQUIERE_REEMBOLSO,
  MOTIVO_VENCIDO,
  registrarCambioPago,
  textoCorto,
} from '../historial-pago';

// TODO(Plexo): este servicio y la verificación de firma son específicos de
// Mercado Pago. Cuando lleguen las credenciales de Plexo y se conozca su
// formato real de notificación, generalizar la interfaz PagoGateway con
// verificarFirma()/consultarEstado() en vez de duplicar este servicio.

type EstadoPago = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'REEMBOLSADO';

export type ResultadoWebhook =
  | 'actualizado'
  | 'sin_cambios'
  | 'sin_resolver'
  | 'orden_desconocida'
  | 'referencia_ajena'
  | 'pago_no_encontrado'
  | 'monto_no_coincide'
  // HU-032 (BL-202): la pasarela cobró, pero el pedido ya no puede usar ese
  // pago (venció y el comensal pagó con otro, o el pedido se canceló).
  | 'requiere_reembolso';

/** HU-032 (BL-202): quién pidió aplicar el estado de la order. */
export type OrigenConsulta = 'WEBHOOK' | 'CONCILIACION';

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

// Lo que queda en el historial del pago junto con el cambio de estado.
function detalleDelCambio(
  estado: EstadoPago,
  statusDetail: string | undefined,
  requiereReembolso: boolean,
): string | null {
  if (requiereReembolso) return DETALLE_REQUIERE_REEMBOLSO;
  if (estado === 'RECHAZADO') return statusDetail ?? null;
  return null;
}

@Injectable()
export class PagosWebhookService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly mercadoPago: MercadoPagoGateway,
    private readonly cfe: CfeService,
    private readonly pedidos: PedidosService,
  ) {}

  // BL-78: la notificación solo avisa que algo cambió. Se consulta la order
  // a Mercado Pago (fuente de verdad) y se refleja en nuestro Pago y la mesa.
  // Es idempotente: Mercado Pago reintenta hasta recibir un 200, y siempre
  // se lee el estado ACTUAL, así que una notificación duplicada o desordenada
  // no puede dejar un estado viejo.
  //
  // HU-032 (BL-202): la conciliación de pagos pendientes usa este mismo
  // flujo (origen CONCILIACION) cuando el webhook nunca llegó.
  async procesarOrden(
    orderId: string,
    origen: OrigenConsulta = 'WEBHOOK',
  ): Promise<ResultadoWebhook> {
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

    const { resultado, pagoId, pedidoConfirmado, mesaOcupada } =
      await this.tenantPrisma.runInTenantContext(referencia.tenantId, (tx) =>
        this.aplicar(tx, orden, referencia, estado, origen),
      );

    // BL-311: recién con la transacción confirmada se avisa a cocina y al
    // comensal. Si la respuesta directa del cobro ya confirmó el pedido,
    // pedidoConfirmado es null y no se avisa dos veces.
    if (pedidoConfirmado) {
      this.pedidos.notificarPedidoConfirmado(
        referencia.tenantId,
        pedidoConfirmado,
      );
    }
    if (mesaOcupada) {
      this.pedidos.notificarEstadoMesa(
        referencia.tenantId,
        mesaOcupada,
        'OCUPADA',
      );
    }

    // Pago aprobado: se emite el CFE en segundo plano (con reintentos
    // acotados), para no demorar el 200 (Mercado Pago reintenta si tarda).
    // También en 'sin_cambios': si la emisión falló antes, el reintento de
    // la notificación la completa.
    if (
      estado === 'APROBADO' &&
      pagoId &&
      (resultado === 'actualizado' || resultado === 'sin_cambios')
    ) {
      this.cfe.emitirEnSegundoPlano(referencia.tenantId, pagoId);
    }
    return resultado;
  }

  private async aplicar(
    tx: PrismaClient,
    orden: OrdenConsultada,
    referencia: { tenantId: string; pedidoId: string },
    estado: EstadoPago,
    origen: OrigenConsulta,
  ): Promise<{
    resultado: ResultadoWebhook;
    pagoId?: string;
    pedidoConfirmado?: PedidoParaKds | null;
    /** HU-017 (BL-60): mesa que volvió a OCUPADA, para avisar al mapa. */
    mesaOcupada?: string;
  }> {
    const { tenantId, pedidoId } = referencia;
    const candidatos = await tx.pago.findMany({
      where: { pedidoId, medioPago: 'MERCADOPAGO' },
    });
    // El webhook puede llegar antes de que la respuesta del cobro guarde la
    // referencia: en ese caso el pago es el PENDIENTE que todavía no la tiene.
    //
    // HU-032 (BL-202): o un pago que VENCIÓ sin que llegara nunca la
    // respuesta del cobro (sin referencia): la notificación es tardía.
    const sinReferencia = candidatos.filter((p) => !p.pasarelaReferencia);
    const pago =
      candidatos.find((p) => p.pasarelaReferencia === orden.id) ??
      sinReferencia.find((p) => p.estado === 'PENDIENTE') ??
      sinReferencia.find(
        (p) => p.estado === 'RECHAZADO' && p.motivoRechazo === MOTIVO_VENCIDO,
      );

    if (!pago) {
      Logger.warn(
        `Webhook: no hay un Pago de Mercado Pago para la order ${orden.id}`,
        PagosWebhookService.name,
      );
      return { resultado: 'pago_no_encontrado' };
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
      return { resultado: 'monto_no_coincide' };
    }

    if (pago.estado === estado) {
      // Mismo estado (por ejemplo, un pago vencido cuya order después
      // también falló): solo se completa la referencia si faltaba.
      if (pago.pasarelaReferencia !== orden.id) {
        await tx.pago.update({
          where: { id: pago.id },
          data: { pasarelaReferencia: orden.id },
        });
      }
      // Un aviso repetido de un pago marcado para reembolso no debe emitir
      // el CFE (procesarOrden lo emite en 'sin_cambios').
      const marcadoParaReembolso = await tx.pagoEstadoHistorial.count({
        where: { pagoId: pago.id, detalle: DETALLE_REQUIERE_REEMBOLSO },
      });
      return {
        resultado:
          marcadoParaReembolso > 0 ? 'requiere_reembolso' : 'sin_cambios',
        pagoId: pago.id,
      };
    }

    const pedido = await tx.pedido.findUnique({
      where: { id: pedidoId },
      select: { mesaId: true, estado: true },
    });

    // HU-032 (BL-202): una aprobación tardía (el pago ya había vencido, o se
    // había rechazado) se aplica si el pedido todavía la puede usar. Si el
    // comensal ya pagó con otro pago, o el pedido se canceló al cerrar la
    // mesa (HU-017), la pasarela cobró de más: el pago queda APROBADO (es lo
    // que pasó) pero NO confirma el pedido, y queda marcado para reembolso
    // (HU-024, BL-104, todavía sin implementar).
    let requiereReembolso = false;
    if (estado === 'APROBADO') {
      const otroAprobado = await tx.pago.count({
        where: { pedidoId, estado: 'APROBADO', id: { not: pago.id } },
      });
      requiereReembolso = otroAprobado > 0 || pedido?.estado === 'CANCELADO';
    }

    await tx.pago.update({
      where: { id: pago.id },
      data: {
        estado,
        pasarelaReferencia: orden.id,
        motivoRechazo:
          estado === 'RECHAZADO' ? textoCorto(orden.statusDetail) : null,
      },
    });
    await registrarCambioPago(tx, {
      tenantId,
      pagoId: pago.id,
      estadoAnterior: pago.estado,
      estadoNuevo: estado,
      origen,
      detalle: detalleDelCambio(estado, orden.statusDetail, requiereReembolso),
    });

    if (requiereReembolso) {
      Logger.error(
        `El pago ${pago.id} (order ${orden.id}) se aprobó, pero el pedido ${pedidoId} ya está pagado o cancelado: requiere reembolso`,
        undefined,
        PagosWebhookService.name,
      );
      return { resultado: 'requiere_reembolso', pagoId: pago.id };
    }

    // La mesa solo se toca si sigue EN_PROCESO_DE_PAGO: una notificación
    // tardía no debe ocupar una mesa que ya siguió su curso. BL-311: aprobado
    // o rechazado, vuelve a OCUPADA (con prepago, el comensal paga antes de
    // comer; la mesa la libera el cierre de sesión, HU-017).
    let pedidoConfirmado: PedidoParaKds | null = null;
    let mesaOcupada: string | undefined;
    if (estado === 'APROBADO' || estado === 'RECHAZADO') {
      if (pedido) {
        const mesa = await tx.mesa.updateMany({
          where: { id: pedido.mesaId, estado: 'EN_PROCESO_DE_PAGO' },
          data: { estado: 'OCUPADA' },
        });
        if (mesa.count > 0) mesaOcupada = pedido.mesaId;
      }
      // BL-311 (RD.03): pago aprobado => el pedido pasa a RECIBIDO.
      if (estado === 'APROBADO') {
        pedidoConfirmado = await this.pedidos.confirmarPagoEnTx(
          tx,
          tenantId,
          pedidoId,
        );
      }
    }

    return {
      resultado: 'actualizado',
      pagoId: pago.id,
      pedidoConfirmado,
      mesaOcupada,
    };
  }
}
