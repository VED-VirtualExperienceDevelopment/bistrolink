import { Injectable } from '@nestjs/common';
import { PedidoEstado, PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import { bloquearColaDelTenant } from '../pedidos/cola-kds';
import {
  ANTIGUEDAD_POR_DEFECTO_HORAS,
  type LimpiarPedidosDto,
} from './dto/limpiar-pedidos.dto';

/** Pedidos que todavía aparecen en el KDS, en «Cobros pendientes» o en «Alertas». */
const ESTADOS_ABIERTOS: PedidoEstado[] = [
  PedidoEstado.PENDIENTE_PAGO,
  PedidoEstado.RECIBIDO,
  PedidoEstado.EN_PREPARACION,
  PedidoEstado.LISTO_PARA_ENTREGAR,
];

/**
 * A qué estado pasa cada pedido abierto. Sin pagar → CANCELADO (incluye el
 * aviso de efectivo, que son columnas del pedido). Pagado → ENTREGADO: tiene
 * pago aprobado y CFE, así que no se cancela ni se borra.
 */
export function estadoDeCierre(estado: PedidoEstado): PedidoEstado {
  return estado === PedidoEstado.PENDIENTE_PAGO
    ? PedidoEstado.CANCELADO
    : PedidoEstado.ENTREGADO;
}

/** Un pedido cerrado, con la forma de `pedido:actualizado`. */
export interface PedidoCerrado {
  id: string;
  estado: PedidoEstado;
  actualizadoEn: string;
  mesaId: string;
  mesaNumero: number;
  lineas: { id: string; nombreSnapshot: string; cantidad: number }[];
}

/** Resumen del área `pedidos` (lo que responde la API). */
export interface ResumenPedidos {
  /** Pedidos abiertos encontrados, por estado (antes de cerrarlos). */
  encontrados: Partial<Record<PedidoEstado, number>>;
  cancelados: number;
  entregados: number;
}

export interface ResultadoLimpieza extends ResumenPedidos {
  /** Para avisar por socket. Vacío en dry-run. */
  cerrados: PedidoCerrado[];
}

/**
 * BL-475 (BL-285): cierra los pedidos de prueba que quedaron abiertos.
 * Decisión del 06/11/2026: **cerrar, no borrar**. Los pedidos de prueba
 * pagados tienen CFE (registro fiscal) y no se borran; cada cierre queda en
 * el historial de estados y en la auditoría, como cualquier transición.
 *
 * Solo existe con E2E_CLEANUP_ENABLED=true (ver TestingModule). Corre en el
 * tenant del token: con el RLS no ve pedidos de otro establecimiento.
 */
@Injectable()
export class LimpiezaPruebasService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async limpiar(
    tenantId: string,
    actorKeycloakId: string,
    dto: LimpiarPedidosDto,
  ): Promise<ResultadoLimpieza> {
    const dryRun = dto.dryRun === true;

    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      // Antes de leer: así ninguna promoción de la cola (ADR 0010) cambia
      // un pedido entre la lectura y el cierre.
      if (!dryRun) await bloquearColaDelTenant(tx, tenantId);

      const pedidos = await tx.pedido.findMany({
        where: this.filtro(dto),
        select: { id: true, estado: true },
      });

      const encontrados: Partial<Record<PedidoEstado, number>> = {};
      for (const { estado } of pedidos) {
        encontrados[estado] = (encontrados[estado] ?? 0) + 1;
      }
      const sinPagar = pedidos
        .filter((p) => estadoDeCierre(p.estado) === PedidoEstado.CANCELADO)
        .map((p) => p.id);
      const pagados = pedidos
        .filter((p) => estadoDeCierre(p.estado) === PedidoEstado.ENTREGADO)
        .map((p) => p.id);

      // En dry-run, cancelados y entregados son los que se cerrarían.
      if (dryRun || pedidos.length === 0) {
        return {
          encontrados,
          cancelados: sinPagar.length,
          entregados: pagados.length,
          cerrados: [],
        };
      }

      await this.cerrar(tx, sinPagar, PedidoEstado.CANCELADO);
      await this.cerrar(tx, pagados, PedidoEstado.ENTREGADO);

      const usuario = await tx.usuario.findUnique({
        where: { keycloakId: actorKeycloakId },
        select: { id: true },
      });
      await tx.pedidoEstadoHistorial.createMany({
        data: pedidos.map((p) => ({
          tenantId,
          pedidoId: p.id,
          usuarioId: usuario?.id ?? null,
          estadoAnterior: p.estado,
          estadoNuevo: estadoDeCierre(p.estado),
        })),
      });
      await this.auditLog.registrarEnTx(tx, {
        action: AuditAction.PEDIDO_LIMPIEZA_PRUEBAS,
        tenantId,
        actorKeycloakId,
        detalle: {
          motivo: 'limpieza de datos de prueba (BL-285)',
          cancelados: sinPagar.length,
          entregados: pagados.length,
          pedidos: pedidos.map((p) => p.id),
        },
      });

      const cerrados = await tx.pedido.findMany({
        where: { id: { in: pedidos.map((p) => p.id) } },
        select: {
          id: true,
          estado: true,
          updatedAt: true,
          mesa: { select: { id: true, numero: true } },
          lineas: {
            select: { id: true, nombreSnapshot: true, cantidad: true },
          },
        },
      });

      return {
        encontrados,
        cancelados: sinPagar.length,
        entregados: pagados.length,
        cerrados: cerrados.map((p) => ({
          id: p.id,
          estado: p.estado,
          actualizadoEn: p.updatedAt.toISOString(),
          mesaId: p.mesa.id,
          mesaNumero: p.mesa.numero,
          lineas: p.lineas,
        })),
      };
    });
  }

  /**
   * Con ids: esos pedidos, si siguen abiertos. Sin ids: los abiertos creados
   * hace más de `antiguedadHoras` (0 = todos).
   */
  private filtro(dto: LimpiarPedidosDto) {
    if (dto.pedidoIds !== undefined) {
      return { id: { in: dto.pedidoIds }, estado: { in: ESTADOS_ABIERTOS } };
    }
    const horas = dto.antiguedadHoras ?? ANTIGUEDAD_POR_DEFECTO_HORAS;
    const limite = new Date(Date.now() - horas * 60 * 60 * 1000);
    return { estado: { in: ESTADOS_ABIERTOS }, createdAt: { lte: limite } };
  }

  private async cerrar(
    tx: PrismaClient,
    ids: string[],
    nuevoEstado: PedidoEstado,
  ): Promise<void> {
    if (ids.length === 0) return;
    await tx.pedido.updateMany({
      where: { id: { in: ids } },
      data: { estado: nuevoEstado },
    });
  }
}
