import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import { KdsGateway } from '../pedidos/kds.gateway';
import { MenuGateway } from '../menu/menu.gateway';
import {
  cantidadesPorItem,
  faltaStock,
  tipoAlerta,
  type TipoAlertaStock,
} from './estado-stock';

/**
 * Una alerta que se avisa en vivo al administrador (D5). Solo nombre y
 * cantidades: nada de ventas (BL-122). `vendidoSinStock`: unidades que se
 * cobraron sin stock por dos pagos casi simultáneos (D3, ADR 0009).
 */
export interface AlertaStockEnVivo {
  itemId: string;
  nombre: string;
  stockActual: number;
  umbralAlerta: number;
  tipo: TipoAlertaStock;
  vendidoSinStock?: number;
}

/** Lo que hay que avisar después de confirmar el pago. */
export interface AvisosStock {
  alertas: AlertaStockEnVivo[];
  /** Ítems que se agotaron con este pedido (la carta del comensal los bloquea). */
  agotados: string[];
}

interface FilaStock {
  id: string;
  nombre: string;
  stock_actual: number;
  umbral_alerta: number;
  disponible: boolean;
}

/** Actor de la auditoría de una sobreventa: la confirmación del pago. */
const ACTOR_SISTEMA = 'sistema:confirmacion-de-pago';

/**
 * HU-015 (BL-120): stock de los pedidos (RF.04, RD.09, ADR 0009).
 *
 * - Antes de cobrar (crear el pedido, reservar el pago, registrar el
 *   efectivo) se verifica que alcance: si no, 409 y no se cobra.
 * - Al confirmarse el pago se descuenta en la misma transacción. Las filas
 *   se bloquean (FOR UPDATE, en orden de id para no trabarse con otra
 *   transacción): dos pagos a la vez descuentan uno después del otro.
 * - El stock nunca baja de 0. Si otro pago se llevó las últimas unidades
 *   entre la reserva y la aprobación, el pedido sigue (ya se cobró): el ítem
 *   queda agotado, la alerta dice cuántas se vendieron de más y queda en la
 *   auditoría, para que el local lo resuelva con el comensal.
 * - Los avisos se mandan después del commit: al administrador por el
 *   gateway del staff (sala de administradores) y, si se agotó, a la carta
 *   del comensal.
 */
@Injectable()
export class DescuentoStockService {
  private readonly logger = new Logger(DescuentoStockService.name);

  constructor(
    private readonly auditLog: AuditLogService,
    private readonly kdsGateway: KdsGateway,
    private readonly menuGateway: MenuGateway,
  ) {}

  /** 409 si el stock no alcanza para lo que pide el pedido. */
  async verificarPedidoEnTx(tx: PrismaClient, pedidoId: string): Promise<void> {
    const lineas = await tx.lineaPedido.findMany({
      where: { pedidoId },
      select: { itemCartaId: true, cantidad: true },
    });
    const cantidades = cantidadesPorItem(lineas);
    if (cantidades.size === 0) return;

    const items = await tx.itemCarta.findMany({
      where: { id: { in: [...cantidades.keys()] }, controlaStock: true },
      select: {
        id: true,
        nombre: true,
        controlaStock: true,
        stockActual: true,
        umbralAlerta: true,
      },
    });
    for (const item of items) {
      const mensaje = faltaStock(item, cantidades.get(item.id) ?? 0);
      if (mensaje) throw new ConflictException(mensaje);
    }
  }

  /**
   * Descuenta lo que pide el pedido de los ítems con control de stock. Corre
   * dentro de la transacción que confirma el pago (confirmarPagoEnTx).
   */
  async descontarEnTx(
    tx: PrismaClient,
    tenantId: string,
    pedidoId: string,
  ): Promise<AvisosStock> {
    const avisos: AvisosStock = { alertas: [], agotados: [] };
    const lineas = await tx.lineaPedido.findMany({
      where: { pedidoId },
      select: { itemCartaId: true, cantidad: true },
    });
    const cantidades = cantidadesPorItem(lineas);
    if (cantidades.size === 0) return avisos;

    const filas = await tx.$queryRaw<FilaStock[]>(Prisma.sql`
      SELECT id, nombre, stock_actual, umbral_alerta, disponible
      FROM item_carta
      WHERE tenant_id = ${tenantId}::uuid
        AND controla_stock
        AND id IN (${Prisma.join([...cantidades.keys()].map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id
      FOR UPDATE`);

    for (const fila of filas) {
      const pedidas = cantidades.get(fila.id) ?? 0;
      const stockActual = Math.max(fila.stock_actual - pedidas, 0);
      const vendidoSinStock = Math.max(pedidas - fila.stock_actual, 0);
      const disponible = fila.disponible && stockActual > 0;

      // Secuencial a propósito (Sonar S9382): misma transacción, filas ya
      // bloqueadas; son los pocos ítems de un pedido.
      await /* NOSONAR */ tx.itemCarta.update({
        where: { id: fila.id },
        data: { stockActual, disponible },
      });
      if (vendidoSinStock > 0) {
        await /* NOSONAR */ this.auditLog.registrarEnTx(tx, {
          action: AuditAction.CARTA_ITEM_VENDIDO_SIN_STOCK,
          tenantId,
          actorKeycloakId: ACTOR_SISTEMA,
          entidadId: fila.id,
          detalle: {
            nombre: fila.nombre,
            pedidoId,
            unidadesDeMas: vendidoSinStock,
          },
        });
      }

      const tipo = tipoAlerta({
        controlaStock: true,
        stockActual,
        umbralAlerta: fila.umbral_alerta,
      });
      if (tipo) {
        avisos.alertas.push({
          itemId: fila.id,
          nombre: fila.nombre,
          stockActual,
          umbralAlerta: fila.umbral_alerta,
          tipo,
          ...(vendidoSinStock > 0 && { vendidoSinStock }),
        });
      }
      if (fila.disponible && !disponible) avisos.agotados.push(fila.id);
    }
    return avisos;
  }

  /**
   * HU-024 (BL-104): devuelve al stock lo que había descontado un pedido que
   * se cancela antes de que cocina lo empiece (RECIBIDO). Corre dentro de la
   * transacción de la cancelación. Un ítem que se había agotado (stock 0 y
   * no disponible) vuelve a estar disponible. Devuelve esos ítems, para
   * avisarle a la carta después del commit.
   */
  async reponerEnTx(
    tx: PrismaClient,
    tenantId: string,
    pedidoId: string,
  ): Promise<string[]> {
    const lineas = await tx.lineaPedido.findMany({
      where: { pedidoId },
      select: { itemCartaId: true, cantidad: true },
    });
    const cantidades = cantidadesPorItem(lineas);
    if (cantidades.size === 0) return [];

    const filas = await tx.$queryRaw<FilaStock[]>(Prisma.sql`
      SELECT id, nombre, stock_actual, umbral_alerta, disponible
      FROM item_carta
      WHERE tenant_id = ${tenantId}::uuid
        AND controla_stock
        AND id IN (${Prisma.join([...cantidades.keys()].map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id
      FOR UPDATE`);

    const vuelvenADisponible: string[] = [];
    for (const fila of filas) {
      const agotado = fila.stock_actual === 0 && !fila.disponible;
      // Secuencial a propósito (Sonar S9382): misma transacción, filas ya
      // bloqueadas; son los pocos ítems de un pedido.
      await /* NOSONAR */ tx.itemCarta.update({
        where: { id: fila.id },
        data: {
          stockActual: fila.stock_actual + (cantidades.get(fila.id) ?? 0),
          ...(agotado && { disponible: true }),
        },
      });
      if (agotado) vuelvenADisponible.push(fila.id);
    }
    return vuelvenADisponible;
  }

  /** HU-024 (BL-104): después del commit, avisa que el stock volvió. */
  avisarReposicion(tenantId: string, disponibles: string[]): void {
    this.kdsGateway.emitirStockActualizado(tenantId);
    for (const itemId of disponibles) {
      this.menuGateway.emitItemUpdated(tenantId, { itemId, disponible: true });
    }
  }

  /** Después del commit: avisa al administrador y a la carta del comensal. */
  avisar(tenantId: string, avisos: AvisosStock): void {
    for (const alerta of avisos.alertas) {
      this.kdsGateway.emitirAlertaStock(tenantId, alerta);
      if (alerta.vendidoSinStock) {
        this.logger.warn(
          `Stock: "${alerta.nombre}" se vendió sin stock (${alerta.vendidoSinStock} de más) en el tenant ${tenantId}`,
        );
      }
    }
    for (const itemId of avisos.agotados) {
      this.menuGateway.emitItemUpdated(tenantId, { itemId, disponible: false });
    }
  }
}
