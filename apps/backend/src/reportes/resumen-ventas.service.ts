import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export const HORA_MS = 60 * 60 * 1000;

/**
 * Al aprobarse un pago se recalculan la hora en curso y la anterior: el pago
 * cuenta en la hora en que se creó, y puede haberse creado (reservado) en la
 * hora anterior y aprobado en esta.
 */
export const HORAS_AL_COBRAR = 2;

/** Rango de horas [desde, hasta): desde incluido, hasta excluido. */
export interface VentanaHoras {
  desde: Date;
  hasta: Date;
}

/** Filas que quedaron en cada tabla del resumen para la ventana. */
export interface ResultadoResumen {
  ventas: number;
  platos: number;
}

/** El comienzo de la hora (en UTC) de una fecha. */
export function truncarHora(fecha: Date): Date {
  return new Date(Math.floor(fecha.getTime() / HORA_MS) * HORA_MS);
}

/** Las últimas `horas` horas, incluida la hora en curso completa. */
export function ventanaReciente(ahora: Date, horas: number): VentanaHoras {
  const hasta = new Date(truncarHora(ahora).getTime() + HORA_MS);
  return { desde: new Date(hasta.getTime() - horas * HORA_MS), hasta };
}

/**
 * HU-012 (BL-219): mantiene las tablas de resumen del dashboard
 * (resumen_ventas_hora y resumen_platos_hora) a partir de los pagos
 * APROBADOS.
 *
 * - Idempotente: borra la ventana y la vuelve a calcular desde pago, pedido y
 *   linea_pedido, en una transacción. Correrlo dos veces deja lo mismo, y
 *   recoge pagos que se aprobaron tarde o se reembolsaron.
 * - Un candado por tenant (pg_advisory_xact_lock) evita que dos recálculos
 *   del mismo establecimiento (dos cobros a la vez, o un cobro y el job, o
 *   dos réplicas de la API) choquen al insertar las mismas filas.
 * - Dentro del contexto del tenant (RLS) y además con tenant_id en cada
 *   consulta. Todo con parámetros (Prisma.sql), nunca concatenando texto.
 * - `hora` es la hora del pago truncada en UTC; el dashboard la pasa a la
 *   zona del local al leer.
 * - La carga inicial (historial existente) la hizo la migración
 *   20261102120000_reportes_sesion_mesa_y_resumen_ventas con las mismas
 *   consultas.
 */
@Injectable()
export class ResumenVentasService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /** Recalcula las horas que puede haber tocado un pago recién aprobado. */
  recalcularRecientes(
    tenantId: string,
    ahora: Date = new Date(),
  ): Promise<ResultadoResumen> {
    return this.recalcularVentana(
      tenantId,
      ventanaReciente(ahora, HORAS_AL_COBRAR),
    );
  }

  async recalcularVentana(
    tenantId: string,
    ventana: VentanaHoras,
  ): Promise<ResultadoResumen> {
    const desde = truncarHora(ventana.desde).toISOString();
    const hasta = truncarHora(ventana.hasta).toISOString();

    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`resumen_ventas:${tenantId}`}))`,
      );

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM resumen_ventas_hora
        WHERE tenant_id = ${tenantId}::uuid
          AND hora >= ${desde}::timestamptz
          AND hora < ${hasta}::timestamptz`);

      const ventas = await tx.$executeRaw(Prisma.sql`
        INSERT INTO resumen_ventas_hora
          (tenant_id, hora, canal, medio_pago, pedidos, monto, actualizado_en)
        SELECT pg.tenant_id,
               date_trunc('hour', pg.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
               p.canal,
               pg.medio_pago,
               COUNT(DISTINCT pg.pedido_id)::int,
               SUM(pg.monto),
               now()
        FROM pago pg
        JOIN pedido p ON p.id = pg.pedido_id
        WHERE pg.tenant_id = ${tenantId}::uuid
          AND pg.estado = 'APROBADO'
          AND pg.created_at >= ${desde}::timestamptz
          AND pg.created_at < ${hasta}::timestamptz
        GROUP BY 1, 2, 3, 4`);

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM resumen_platos_hora
        WHERE tenant_id = ${tenantId}::uuid
          AND hora >= ${desde}::timestamptz
          AND hora < ${hasta}::timestamptz`);

      // Cada pedido cuenta en la hora de su primer pago aprobado (un pedido
      // con dos pagos aprobados no duplica sus platos). El nombre es el de la
      // última venta del plato.
      const platos = await tx.$executeRaw(Prisma.sql`
        INSERT INTO resumen_platos_hora
          (tenant_id, hora, canal, item_carta_id, nombre, cantidad, recaudado, actualizado_en)
        SELECT p.tenant_id,
               date_trunc('hour', pagados.pagado_en AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
               p.canal,
               lp.item_carta_id,
               (array_agg(lp.nombre_snapshot ORDER BY lp.created_at DESC))[1],
               SUM(lp.cantidad)::int,
               SUM(lp.subtotal),
               now()
        FROM (
          SELECT pedido_id, MIN(created_at) AS pagado_en
          FROM pago
          WHERE tenant_id = ${tenantId}::uuid
            AND estado = 'APROBADO'
            AND pedido_id IN (
              SELECT pedido_id FROM pago
              WHERE tenant_id = ${tenantId}::uuid
                AND estado = 'APROBADO'
                AND created_at >= ${desde}::timestamptz
                AND created_at < ${hasta}::timestamptz
            )
          GROUP BY pedido_id
          HAVING MIN(created_at) >= ${desde}::timestamptz
             AND MIN(created_at) < ${hasta}::timestamptz
        ) pagados
        JOIN pedido p ON p.id = pagados.pedido_id
        JOIN linea_pedido lp ON lp.pedido_id = p.id
        GROUP BY 1, 2, 3, 4`);

      return { ventas, platos };
    });
  }
}
