import { Prisma } from '@prisma/client';

/**
 * HU-045 (BL-547): insignia «Más pedido», calculada solo con ventas reales.
 *
 * Método (Anexo 2 §8): ranking por popularidad, el baseline de un sistema
 * de recomendación. Variable: unidades con pago aprobado por plato en una
 * ventana móvil, por local. Fuente: resumen_platos_hora (HU-012), que se
 * recalcula al aprobarse cada pago, así que no hace falta caché.
 *
 * Riesgo: sesgo de popularidad (lo más pedido se pide más porque se ve).
 * Lo acotan la ventana móvil, el top chico y la «Sugerencia del local»
 * (HU-044), que el dueño elige.
 */
export const VENTANA_MAS_PEDIDOS_DIAS = 30;
/** Con menos unidades no hay insignia: un par de ventas no es «más pedido». */
export const MINIMO_UNIDADES_MAS_PEDIDO = 10;
export const CANTIDAD_MAS_PEDIDOS = 3;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Lo mínimo del cliente de Prisma que hace falta (la transacción del menú). */
export interface ConsultaCruda {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}

/**
 * Ids de los platos «más pedidos» entre `candidatos` (los platos de la carta
 * que se está mostrando: así cuenta solo el local, y no los archivados), en
 * orden: más unidades primero y, a igual cantidad, la venta más reciente.
 *
 * Corre dentro de la transacción del menú (RLS) y además filtra por
 * tenant_id explícito. HU-046 la usa como respaldo cuando no hay reglas,
 * pasando solo los platos sugeribles.
 */
export async function platosMasPedidos(
  tx: ConsultaCruda,
  tenantId: string,
  candidatos: readonly string[],
  ahora: Date = new Date(),
): Promise<string[]> {
  if (candidatos.length === 0) return [];
  const desde = new Date(ahora.getTime() - VENTANA_MAS_PEDIDOS_DIAS * DIA_MS);
  const filas = await tx.$queryRaw<{ item_carta_id: string }[]>(Prisma.sql`
    SELECT item_carta_id
    FROM resumen_platos_hora
    WHERE tenant_id = ${tenantId}::uuid
      AND hora >= ${desde}
      AND item_carta_id::text IN (${Prisma.join([...candidatos])})
    GROUP BY item_carta_id
    HAVING SUM(cantidad) >= ${MINIMO_UNIDADES_MAS_PEDIDO}
    ORDER BY SUM(cantidad) DESC, MAX(hora) DESC, item_carta_id
    LIMIT ${CANTIDAD_MAS_PEDIDOS}`);
  return filas.map((f) => f.item_carta_id);
}
