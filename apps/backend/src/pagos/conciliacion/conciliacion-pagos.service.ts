import { Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { PedidosService } from '../../pedidos/pedidos.service';
import {
  PagosWebhookService,
  ResultadoWebhook,
} from '../webhooks/pagos-webhook.service';
import { MOTIVO_VENCIDO, registrarCambioPago } from '../historial-pago';
import { ConfiguracionConciliacion } from './configuracion-conciliacion';

export interface ResumenConciliacion {
  /** Pagos pendientes revisados. */
  revisados: number;
  /** Resueltos al consultarle a la pasarela (aprobados o rechazados). */
  conciliados: number;
  /** Vencidos por no tener confirmación a tiempo. */
  vencidos: number;
  /** La consulta a la pasarela falló (se reintenta en la próxima corrida). */
  errores: number;
}

export function resumenVacio(): ResumenConciliacion {
  return { revisados: 0, conciliados: 0, vencidos: 0, errores: 0 };
}

// Resultados de procesarOrden que cambiaron el estado del pago.
const RESULTADOS_RESUELTOS: ReadonlySet<ResultadoWebhook> = new Set([
  'actualizado',
  'requiere_reembolso',
]);

type ParametrosConciliacion = Pick<
  ConfiguracionConciliacion,
  'conciliarDespuesMs' | 'vencerDespuesMs' | 'lote'
>;

/**
 * HU-032 (BL-202): vencimiento y conciliación de los pagos que quedaron
 * PENDIENTES porque el webhook de la pasarela nunca llegó (o la pasarela no
 * respondió al cobrar, modo degradado de BL-77).
 *
 * Por cada pago PENDIENTE con más de `conciliarDespuesMs`:
 * 1. Si es de Mercado Pago y tiene la order guardada, se le consulta el
 *    estado y se aplica con el MISMO flujo que el webhook (procesarOrden):
 *    pedido a RECIBIDO, mesa a OCUPADA, CFE. Es idempotente: si el webhook
 *    llega a la vez, uno de los dos no encuentra nada que cambiar.
 * 2. Si sigue PENDIENTE y tiene más de `vencerDespuesMs`, vence: RECHAZADO
 *    con motivo VENCIDO. El pedido sigue en PENDIENTE_PAGO (no entra a
 *    cocina) y el comensal puede pagar de nuevo. La mesa sale de
 *    EN_PROCESO_DE_PAGO si no le queda otro cobro en curso.
 *
 * Plexo quedó fuera del proyecto (17/10/2026): sus pagos solo vencen. Un
 * pago sin order (la pasarela no respondió) tampoco se puede consultar y
 * también vence; si después llega el webhook con la aprobación, se aplica
 * igual (PagosWebhookService, aprobación tardía).
 *
 * Depende de TenantPrismaService (por request): el job lo resuelve con un
 * contexto propio (ConciliacionPagosJob).
 */
@Injectable()
export class ConciliacionPagosService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly webhook: PagosWebhookService,
    private readonly pedidos: PedidosService,
  ) {}

  async conciliarTenant(
    tenantId: string,
    parametros: ParametrosConciliacion,
    ahora: Date = new Date(),
  ): Promise<ResumenConciliacion> {
    const resumen = resumenVacio();
    const limiteConsulta = new Date(
      ahora.getTime() - parametros.conciliarDespuesMs,
    );
    const limiteVencimiento = new Date(
      ahora.getTime() - parametros.vencerDespuesMs,
    );

    const pendientes = await this.tenantPrisma.runInTenantContext(
      tenantId,
      (tx) =>
        tx.pago.findMany({
          where: { estado: 'PENDIENTE', createdAt: { lt: limiteConsulta } },
          orderBy: { createdAt: 'asc' },
          take: parametros.lote,
          select: {
            id: true,
            medioPago: true,
            pasarelaReferencia: true,
            createdAt: true,
          },
        }),
    );

    // Secuencial a propósito (Sonar S9382): de a un pago, para no mandarle
    // ráfagas de consultas a Mercado Pago ni ocupar varias conexiones del pool
    // único de la API (BL-430) a la vez. Son pocos pagos (lote acotado) y el
    // job corre en segundo plano: el tiempo total no importa.
    for (const pago of pendientes) {
      resumen.revisados++;

      if (pago.medioPago === 'MERCADOPAGO' && pago.pasarelaReferencia) {
        try {
          const resultado = await /* NOSONAR */ this.webhook.procesarOrden(
            pago.pasarelaReferencia,
            'CONCILIACION',
          );
          if (RESULTADOS_RESUELTOS.has(resultado)) {
            resumen.conciliados++;
            continue;
          }
        } catch (error) {
          // Mercado Pago no respondió: se reintenta en la próxima corrida.
          // Si además ya pasó el plazo, el pago vence igual (abajo): no se
          // deja una mesa trabada por una caída de la pasarela.
          resumen.errores++;
          Logger.warn(
            `Conciliación: no se pudo consultar la order ${pago.pasarelaReferencia} del pago ${pago.id}: ${(error as Error).message}`,
            ConciliacionPagosService.name,
          );
        }
      }

      if (pago.createdAt < limiteVencimiento) {
        const vencido = await /* NOSONAR */ this.vencer(tenantId, pago.id);
        if (vencido) resumen.vencidos++;
      }
    }

    return resumen;
  }

  /**
   * Vence un pago PENDIENTE. Devuelve false si ya no estaba PENDIENTE (lo
   * resolvió el webhook o la consulta entre medio): no hay nada que vencer.
   */
  async vencer(tenantId: string, pagoId: string): Promise<boolean> {
    const resultado = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const { count } = await tx.pago.updateMany({
          where: { id: pagoId, estado: 'PENDIENTE' },
          data: { estado: 'RECHAZADO', motivoRechazo: MOTIVO_VENCIDO },
        });
        if (count === 0) {
          return { vencido: false, mesaOcupada: null };
        }
        await registrarCambioPago(tx, {
          tenantId,
          pagoId,
          estadoAnterior: 'PENDIENTE',
          estadoNuevo: 'RECHAZADO',
          origen: 'VENCIMIENTO',
          detalle: MOTIVO_VENCIDO,
        });

        // La mesa sale de EN_PROCESO_DE_PAGO, salvo que otro comensal de la
        // misma mesa tenga un cobro en curso.
        const { pedido } = await tx.pago.findUniqueOrThrow({
          where: { id: pagoId },
          select: { pedido: { select: { mesaId: true } } },
        });
        const otrosEnCurso = await tx.pago.count({
          where: { estado: 'PENDIENTE', pedido: { mesaId: pedido.mesaId } },
        });
        if (otrosEnCurso > 0) {
          return { vencido: true, mesaOcupada: null };
        }
        const mesa = await tx.mesa.updateMany({
          where: { id: pedido.mesaId, estado: 'EN_PROCESO_DE_PAGO' },
          data: { estado: 'OCUPADA' },
        });
        return {
          vencido: true,
          mesaOcupada: mesa.count > 0 ? pedido.mesaId : null,
        };
      },
    );

    if (resultado.mesaOcupada) {
      this.pedidos.notificarEstadoMesa(
        tenantId,
        resultado.mesaOcupada,
        'OCUPADA',
      );
    }
    return resultado.vencido;
  }
}
