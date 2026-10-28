import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { PedidosService } from '../../pedidos/pedidos.service';
import { SolicitarEfectivoDto } from './solicitar-efectivo.dto';

/**
 * Mismo criterio que «Llamar al mozo» (HU-034): un aviso por minuto. Si el
 * comensal vuelve a tocar antes, se guarda lo nuevo (por ejemplo, otro
 * «con cuánto») pero no se vuelve a avisar.
 */
export const ESPERA_ENTRE_AVISOS_MS = 60_000;

export interface SolicitudEfectivoRegistrada {
  pedidoId: string;
  /** Total del pedido, con 2 decimales. */
  total: string;
  pagaCon: string | null;
  solicitadoEn: Date;
  /** false si ya se había avisado hace menos de un minuto. */
  avisado: boolean;
}

/**
 * HU-031b (BL-442): el comensal de una mesa elige pagar en efectivo.
 *
 * - Solo pedidos de mesa (canal QR, dentro del local). Un pedido para
 *   retirar (canal WEB) se paga con tarjeta: 409.
 * - No crea un Pago: lo vencería el job de HU-032 y bloquearía el pago con
 *   tarjeta. Se guarda en el pedido (efectivo_solicitado_en y, si lo dijo,
 *   efectivo_paga_con) y el pedido sigue en PENDIENTE_PAGO hasta que el mozo
 *   registra el cobro (BL-201, RD.03).
 * - Se avisa al staff con el mismo evento que «Llamar al mozo», con el total
 *   y con cuánto paga.
 *
 * El acceso al pedido (QR y sesión de la mesa) ya lo validaron MesaQrGuard y
 * PedidoAccesoGuard (RD.05).
 */
@Injectable()
export class SolicitudEfectivoService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly pedidos: PedidosService,
  ) {}

  async solicitar(
    tenantId: string,
    pedidoId: string,
    dto: SolicitarEfectivoDto,
    ahora: Date = new Date(),
  ): Promise<SolicitudEfectivoRegistrada> {
    const resultado = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const pedido = await tx.pedido.findUnique({
          where: { id: pedidoId },
          select: {
            canal: true,
            estado: true,
            efectivoSolicitadoEn: true,
            mesa: { select: { id: true, numero: true } },
            lineas: { select: { subtotal: true } },
            pagos: { where: { estado: 'PENDIENTE' }, select: { id: true } },
          },
        });
        if (!pedido) {
          throw new NotFoundException('Pedido no encontrado');
        }
        if (pedido.canal !== 'QR') {
          throw new ConflictException(
            'El pago en efectivo es solo para pedidos hechos en el local. Pagá con tarjeta.',
          );
        }
        const restaurante = await tx.restaurante.findUnique({
          where: { tenantId },
          select: { efectivoHabilitado: true },
        });
        if (!restaurante?.efectivoHabilitado) {
          throw new ConflictException(
            'Este local no acepta pagos en efectivo. Pagá con tarjeta.',
          );
        }
        if (pedido.estado === 'CANCELADO') {
          throw new ConflictException('El pedido está cancelado');
        }
        if (pedido.estado !== 'PENDIENTE_PAGO') {
          throw new ConflictException('Este pedido ya fue pagado');
        }
        if (pedido.pagos.length > 0) {
          throw new ConflictException(
            'Ya hay un pago con tarjeta en curso para este pedido.',
          );
        }

        const total = pedido.lineas.reduce(
          (acumulado, linea) => acumulado.plus(linea.subtotal),
          new Prisma.Decimal(0),
        );
        const pagaCon = dto.pagaCon ? new Prisma.Decimal(dto.pagaCon) : null;
        if (pagaCon?.lessThan(total)) {
          throw new BadRequestException(
            `El monto con el que vas a pagar ($ ${pagaCon.toFixed(2)}) es menor que el total ($ ${total.toFixed(2)})`,
          );
        }

        const anterior = pedido.efectivoSolicitadoEn;
        const avisado =
          !anterior ||
          ahora.getTime() - anterior.getTime() >= ESPERA_ENTRE_AVISOS_MS;
        const solicitadoEn = avisado ? ahora : anterior;
        await tx.pedido.update({
          where: { id: pedidoId },
          data: {
            efectivoSolicitadoEn: solicitadoEn,
            efectivoPagaCon: pagaCon,
          },
        });

        return {
          solicitud: {
            pedidoId,
            total: total.toFixed(2),
            pagaCon: pagaCon?.toFixed(2) ?? null,
            solicitadoEn,
            avisado,
          },
          mesa: pedido.mesa,
        };
      },
    );

    // Con la solicitud ya guardada: aunque el mozo no vea el aviso, la
    // encuentra en «Cobros pendientes».
    if (resultado.solicitud.avisado) {
      this.pedidos.notificarSolicitudEfectivo(tenantId, resultado.mesa, {
        pedidoId,
        total: resultado.solicitud.total,
        pagaCon: resultado.solicitud.pagaCon,
      });
    }
    return resultado.solicitud;
  }
}
