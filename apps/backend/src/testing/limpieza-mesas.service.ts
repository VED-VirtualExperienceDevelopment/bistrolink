import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { MesaEstado, Prisma, PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import {
  MESAS_DEL_SEED,
  NUMERO_MESA_TEMPORAL_MAXIMO,
  NUMERO_MESA_TEMPORAL_MINIMO,
  PREFIJO_ZONA_E2E,
} from './datos-seed';

/** Resumen del área `mesas` (lo que responde la API). */
export interface ResumenMesas {
  /** Mesas del seed que se abrieron (o se sacaron de «en proceso de pago»). */
  reabiertas: number;
  /** Mesas que quedaron LIBRE (sesión cerrada). */
  liberadas: number;
  /** Mesas temporales de los E2E eliminadas. */
  eliminadas: number;
  /** Mesas temporales con pedidos: no se pueden borrar y quedan LIBRE. */
  temporalesConPedidos: number;
  /** Zonas «Zona E2E …» quitadas del plano. */
  zonasEliminadas: number;
}

export interface ResultadoLimpiezaMesas extends ResumenMesas {
  /** Mesas que cambiaron de estado (para avisar al mapa). Vacío en dry-run. */
  cambios: { mesaId: string; estado: MesaEstado }[];
  /** Todas las mesas de salón del tenant: se les sacan las alertas. */
  mesasDelSalon: string[];
}

interface MesaLeida {
  id: string;
  numero: number;
  estado: MesaEstado;
  sesionId: string | null;
  _count: { pedidos: number };
}

interface Zona {
  etiqueta?: unknown;
}

/** Qué hacer con cada mesa. Exportada para los tests. */
export function accionParaMesa(
  mesa: Pick<MesaLeida, 'id' | 'numero' | 'estado'>,
): 'reabrir' | 'pasarAOcupada' | 'liberar' | 'eliminar' | 'nada' {
  if (MESAS_DEL_SEED.includes(mesa.id)) {
    if (mesa.estado === MesaEstado.OCUPADA) return 'nada';
    return mesa.estado === MesaEstado.EN_PROCESO_DE_PAGO
      ? 'pasarAOcupada'
      : 'reabrir';
  }
  if (
    mesa.numero >= NUMERO_MESA_TEMPORAL_MINIMO &&
    mesa.numero <= NUMERO_MESA_TEMPORAL_MAXIMO
  ) {
    return 'eliminar';
  }
  return mesa.estado === MesaEstado.LIBRE ? 'nada' : 'liberar';
}

/** El plano sin las zonas de los E2E, o null si no hay ninguna. */
export function planoSinZonasE2E(
  plano: unknown,
): { plano: Prisma.InputJsonValue; quitadas: number } | null {
  if (!plano || typeof plano !== 'object') return null;
  const { zonas } = plano as { zonas?: unknown };
  if (!Array.isArray(zonas)) return null;
  const quedan = zonas.filter(
    (z: Zona) =>
      !(
        typeof z?.etiqueta === 'string' &&
        z.etiqueta.startsWith(PREFIJO_ZONA_E2E)
      ),
  );
  const quitadas = zonas.length - quedan.length;
  if (quitadas === 0) return null;
  return {
    plano: { ...(plano as Prisma.JsonObject), zonas: quedan },
    quitadas,
  };
}

/**
 * BL-479 (BL-285, ADR 0011): deja las mesas y el plano del tenant como el
 * seed. Corre después del área `pedidos` (sin pedidos abiertos, una mesa
 * se puede cerrar y una temporal, borrar).
 *
 * - Mesas del seed (1 y 2): abiertas, como las deja el seed.
 * - Mesas temporales de los E2E (números 50 a 99): eliminadas; si tienen
 *   pedidos, quedan LIBRE (la base no permite borrarlas).
 * - Las demás mesas de salón: LIBRE, con la sesión cerrada en el historial.
 * - La mesa virtual no se toca.
 * - Plano: se quitan las zonas «Zona E2E …»; lo demás no se toca.
 */
@Injectable()
export class LimpiezaMesasService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async limpiar(
    tenantId: string,
    actorKeycloakId: string,
    dryRun: boolean,
  ): Promise<ResultadoLimpiezaMesas> {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const mesas: MesaLeida[] = await tx.mesa.findMany({
        where: { esVirtual: false },
        select: {
          id: true,
          numero: true,
          estado: true,
          sesionId: true,
          _count: { select: { pedidos: true } },
        },
        orderBy: { numero: 'asc' },
      });
      const restaurantes = await tx.restaurante.findMany({
        select: { id: true, plano: true },
      });

      const porAccion = (accion: ReturnType<typeof accionParaMesa>) =>
        mesas.filter((m) => accionParaMesa(m) === accion);
      const reabrir = porAccion('reabrir');
      const pasarAOcupada = porAccion('pasarAOcupada');
      const temporales = porAccion('eliminar');
      const borrables = temporales.filter((m) => m._count.pedidos === 0);
      const conPedidos = temporales.filter((m) => m._count.pedidos > 0);
      const liberar = [
        ...porAccion('liberar'),
        ...conPedidos.filter((m) => m.estado !== MesaEstado.LIBRE),
      ];
      const planos = restaurantes.flatMap((r) => {
        const nuevo = planoSinZonasE2E(r.plano);
        return nuevo ? [{ id: r.id, ...nuevo }] : [];
      });

      const resumen: ResumenMesas = {
        reabiertas: reabrir.length + pasarAOcupada.length,
        liberadas: liberar.length,
        eliminadas: borrables.length,
        temporalesConPedidos: conPedidos.length,
        zonasEliminadas: planos.reduce((t, p) => t + p.quitadas, 0),
      };
      const mesasDelSalon = mesas.map((m) => m.id);
      const nadaQueHacer =
        resumen.reabiertas +
          resumen.liberadas +
          resumen.eliminadas +
          resumen.zonasEliminadas ===
        0;
      if (dryRun || nadaQueHacer) {
        return { ...resumen, cambios: [], mesasDelSalon };
      }

      const ahora = new Date();
      // Las temporales que se borran también cierran su sesión antes.
      await this.cerrarSesiones(tx, [...liberar, ...borrables], ahora);
      await this.liberar(tx, [...liberar, ...borrables]);
      if (borrables.length > 0) {
        await tx.mesa.deleteMany({
          where: { id: { in: borrables.map((m) => m.id) } },
        });
      }
      for (const mesa of reabrir) {
        await this.abrir(tx, tenantId, mesa, ahora);
      }
      if (pasarAOcupada.length > 0) {
        await tx.mesa.updateMany({
          where: { id: { in: pasarAOcupada.map((m) => m.id) } },
          data: { estado: MesaEstado.OCUPADA },
        });
      }
      for (const { id, plano } of planos) {
        await tx.restaurante.update({ where: { id }, data: { plano } });
      }

      await this.auditLog.registrarEnTx(tx, {
        action: AuditAction.MESA_LIMPIEZA_PRUEBAS,
        tenantId,
        actorKeycloakId,
        detalle: {
          motivo: 'limpieza de datos de prueba (BL-285)',
          ...resumen,
          mesasEliminadas: borrables.map((m) => m.numero),
        },
      });

      return {
        ...resumen,
        cambios: [
          ...liberar.map((m) => ({ mesaId: m.id, estado: MesaEstado.LIBRE })),
          ...[...reabrir, ...pasarAOcupada].map((m) => ({
            mesaId: m.id,
            estado: MesaEstado.OCUPADA,
          })),
        ],
        mesasDelSalon: mesasDelSalon.filter(
          (id) => !borrables.some((m) => m.id === id),
        ),
      };
    });
  }

  /** Cierra en el historial (HU-012) la sesión de las mesas que la tienen. */
  private async cerrarSesiones(
    tx: PrismaClient,
    mesas: MesaLeida[],
    ahora: Date,
  ) {
    const sesiones = mesas
      .map((m) => m.sesionId)
      .filter((s): s is string => s !== null);
    if (sesiones.length === 0) return;
    await tx.sesionMesa.updateMany({
      where: { id: { in: sesiones }, cerradaEn: null },
      data: { cerradaEn: ahora },
    });
  }

  private async liberar(tx: PrismaClient, mesas: MesaLeida[]) {
    if (mesas.length === 0) return;
    await tx.mesa.updateMany({
      where: { id: { in: mesas.map((m) => m.id) } },
      data: {
        estado: MesaEstado.LIBRE,
        sesionId: null,
        sesionAbiertaEn: null,
      },
    });
  }

  /** Como MesasService.abrirSesion: sesión nueva y su fila en el historial. */
  private async abrir(
    tx: PrismaClient,
    tenantId: string,
    mesa: MesaLeida,
    ahora: Date,
  ) {
    await this.cerrarSesiones(tx, [mesa], ahora);
    const sesionId = randomUUID();
    await tx.mesa.update({
      where: { id: mesa.id },
      data: {
        estado: MesaEstado.OCUPADA,
        sesionId,
        sesionAbiertaEn: ahora,
      },
    });
    await tx.sesionMesa.create({
      data: { id: sesionId, tenantId, mesaId: mesa.id, abiertaEn: ahora },
    });
  }
}
