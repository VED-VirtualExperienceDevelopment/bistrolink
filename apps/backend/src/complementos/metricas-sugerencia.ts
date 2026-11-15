import { PedidoCanal, Prisma } from '@prisma/client';

/**
 * HU-046 (BL-554): contadores de la sugerencia de complementos, por local,
 * día del calendario del local (restaurante.timezone) y canal. Nada del
 * comensal ni del pedido: solo cuántas veces se mostró y cuántos platos
 * sugeridos se pagaron.
 *
 * Las dos sumas son un INSERT … ON CONFLICT DO UPDATE: atómicas aunque haya
 * dos a la vez. Con tenant_id explícito, además de la RLS.
 */

/** Lo mínimo del cliente de Prisma que hace falta. */
export interface EscrituraCruda {
  $executeRaw(query: Prisma.Sql): Promise<number>;
}

/** Una sugerencia mostrada (el endpoint devolvió al menos un plato). */
export function sumarMostradaEnTx(
  tx: EscrituraCruda,
  tenantId: string,
  restauranteId: string,
  canal: PedidoCanal,
): Promise<number> {
  return tx.$executeRaw(Prisma.sql`
    INSERT INTO metrica_sugerencia_dia
      (tenant_id, dia, canal, mostradas, aceptadas, actualizado_en)
    SELECT r.tenant_id,
           (now() AT TIME ZONE r.timezone)::date,
           ${canal}::"PedidoCanal",
           1,
           0,
           now()
    FROM restaurante r
    WHERE r.id = ${restauranteId}::uuid
      AND r.tenant_id = ${tenantId}::uuid
    ON CONFLICT (tenant_id, dia, canal) DO UPDATE
      SET mostradas = metrica_sugerencia_dia.mostradas + 1,
          actualizado_en = now()`);
}

/**
 * Los platos sugeridos de un pedido que se acaba de pagar: las líneas que
 * el comensal agregó desde la sugerencia, si el plato sigue siendo
 * sugerible. Va en la transacción que confirma el pago (confirmarPagoEnTx),
 * que corre una sola vez por pedido: no cuenta dos veces.
 */
export function sumarAceptadasEnTx(
  tx: EscrituraCruda,
  tenantId: string,
  pedidoId: string,
): Promise<number> {
  return tx.$executeRaw(Prisma.sql`
    INSERT INTO metrica_sugerencia_dia
      (tenant_id, dia, canal, mostradas, aceptadas, actualizado_en)
    SELECT p.tenant_id,
           (now() AT TIME ZONE r.timezone)::date,
           p.canal,
           0,
           COUNT(*)::int,
           now()
    FROM linea_pedido lp
    JOIN pedido p ON p.id = lp.pedido_id
    JOIN restaurante r ON r.id = p.restaurante_id
    JOIN item_carta ic ON ic.id = lp.item_carta_id
    WHERE lp.tenant_id = ${tenantId}::uuid
      AND lp.pedido_id = ${pedidoId}::uuid
      AND lp.desde_sugerencia
      AND ic.sugerible
    GROUP BY p.tenant_id, r.timezone, p.canal
    ON CONFLICT (tenant_id, dia, canal) DO UPDATE
      SET aceptadas = metrica_sugerencia_dia.aceptadas + EXCLUDED.aceptadas,
          actualizado_en = now()`);
}
