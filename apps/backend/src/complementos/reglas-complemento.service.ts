import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  MINIMO_PEDIDOS_CON_AMBOS,
  reglasDesdeConteos,
  VENTANA_REGLAS_DIAS,
} from './reglas-complemento';

const DIA_MS = 24 * 60 * 60 * 1000;

/** El recálculo de un local puede tardar más que el límite por defecto (5 s). */
const LIMITE_TRANSACCION_MS = 60_000;

/** Lo que dejó un recálculo. */
export interface ResultadoReglas {
  pedidos: number;
  reglas: number;
}

/**
 * HU-046 (BL-552): recalcula las reglas de complemento de un local.
 *
 * - Idempotente: borra las reglas del local y las vuelve a calcular, en una
 *   transacción. Correrlo dos veces deja lo mismo.
 * - Un candado por tenant (pg_advisory_xact_lock) evita que dos réplicas de
 *   la API recalculen el mismo local a la vez.
 * - Dentro del contexto del tenant (RLS) y además con tenant_id en cada
 *   consulta. Todo con parámetros (Prisma.sql), nunca concatenando texto.
 * - Un pedido cuenta una vez por plato, aunque tenga varias líneas o
 *   unidades del mismo: lo que importa es si el plato estuvo en el pedido.
 * - El consecuente es un plato sugerible, sin alcohol y no archivado.
 *   Igual se vuelve a filtrar al sugerir, porque la carta cambia durante
 *   el día.
 */
@Injectable()
export class ReglasComplementoService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async recalcular(
    tenantId: string,
    ahora: Date = new Date(),
  ): Promise<ResultadoReglas> {
    const desde = new Date(ahora.getTime() - VENTANA_REGLAS_DIAS * DIA_MS);
    const candado = `reglas_complemento:${tenantId}`;

    return this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${candado}))`,
        );

        // Platos distintos de cada pedido con pago aprobado en la ventana.
        const platosDePedidosPagados = Prisma.sql`
          SELECT DISTINCT lp.pedido_id, lp.item_carta_id
          FROM linea_pedido lp
          WHERE lp.tenant_id = ${tenantId}::uuid
            AND lp.pedido_id IN (
              SELECT pg.pedido_id
              FROM pago pg
              WHERE pg.tenant_id = ${tenantId}::uuid
                AND pg.estado = 'APROBADO'
                AND pg.created_at >= ${desde}
                AND pg.created_at < ${ahora}
            )`;

        const porPlato = await tx.$queryRaw<
          { item_carta_id: string; pedidos: number }[]
        >(Prisma.sql`
          WITH platos AS (${platosDePedidosPagados})
          SELECT item_carta_id, COUNT(*)::int AS pedidos
          FROM platos
          GROUP BY item_carta_id`);

        const [{ pedidos }] = await tx.$queryRaw<{ pedidos: number }[]>(
          Prisma.sql`
          WITH platos AS (${platosDePedidosPagados})
          SELECT COUNT(DISTINCT pedido_id)::int AS pedidos
          FROM platos`,
        );

        const pares = await tx.$queryRaw<
          {
            antecedente_id: string;
            consecuente_id: string;
            pedidos_con_ambos: number;
          }[]
        >(Prisma.sql`
          WITH platos AS (${platosDePedidosPagados})
          SELECT a.item_carta_id AS antecedente_id,
                 b.item_carta_id AS consecuente_id,
                 COUNT(*)::int AS pedidos_con_ambos
          FROM platos a
          JOIN platos b
            ON b.pedido_id = a.pedido_id
           AND b.item_carta_id <> a.item_carta_id
          JOIN item_carta ic
            ON ic.id = b.item_carta_id
           AND ic.tenant_id = ${tenantId}::uuid
          WHERE ic.sugerible
            AND NOT ic.contiene_alcohol
            AND ic.archivado_en IS NULL
          GROUP BY a.item_carta_id, b.item_carta_id
          HAVING COUNT(*) >= ${MINIMO_PEDIDOS_CON_AMBOS}`);

        const reglas = reglasDesdeConteos({
          pedidos,
          pedidosPorPlato: new Map(
            porPlato.map((f) => [f.item_carta_id, f.pedidos]),
          ),
          pares: pares.map((p) => ({
            antecedenteId: p.antecedente_id,
            consecuenteId: p.consecuente_id,
            pedidosConAmbos: p.pedidos_con_ambos,
          })),
        });

        await tx.reglaComplemento.deleteMany({ where: { tenantId } });
        if (reglas.length > 0) {
          await tx.reglaComplemento.createMany({
            data: reglas.map((r) => ({
              tenantId,
              antecedenteId: r.antecedenteId,
              consecuenteId: r.consecuenteId,
              pedidosConAmbos: r.pedidosConAmbos,
              soporte: r.soporte,
              confianza: r.confianza,
              lift: r.lift,
              calculadaEn: ahora,
            })),
          });
        }
        return { pedidos, reglas: reglas.length };
      },
      { timeout: LIMITE_TRANSACCION_MS },
    );
  }
}
