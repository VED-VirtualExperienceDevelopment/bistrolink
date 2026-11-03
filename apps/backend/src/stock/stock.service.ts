import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import { AjustarStockDto } from './dto/ajustar-stock.dto';
import {
  compararAlertas,
  disponibleTrasAjuste,
  tipoAlerta,
  type StockDeItem,
  type TipoAlertaStock,
} from './estado-stock';

/** Un ítem en la pantalla de stock de la jornada. */
export interface ItemStock extends StockDeItem {
  id: string;
  nombre: string;
  categoria: { id: string; nombre: string };
  disponible: boolean;
  /** La alerta que tiene hoy, o null. */
  alerta: TipoAlertaStock | null;
}

/**
 * Una alerta de la campana (D4, D5). Solo nombre y cantidades: nada de
 * ventas (BL-122).
 */
export interface AlertaStock {
  itemId: string;
  nombre: string;
  stockActual: number;
  umbralAlerta: number;
  tipo: TipoAlertaStock;
}

export interface ResultadoAjusteStock {
  items: ItemStock[];
  /** Ítems cuya disponibilidad cambió con el ajuste (para la carta en vivo). */
  disponibilidadCambiada: { itemId: string; disponible: boolean }[];
}

/** Ítems de la carta que no están archivados, en una categoría activa. */
const DE_LA_CARTA = {
  archivadoEn: null,
  categoria: { archivadaEn: null },
} satisfies Prisma.ItemCartaWhereInput;

const SELECT_ITEM_STOCK = {
  id: true,
  nombre: true,
  disponible: true,
  controlaStock: true,
  stockActual: true,
  umbralAlerta: true,
  categoria: { select: { id: true, nombre: true } },
} satisfies Prisma.ItemCartaSelect;

type FilaItemStock = Prisma.ItemCartaGetPayload<{
  select: typeof SELECT_ITEM_STOCK;
}>;

function aItemStock(fila: FilaItemStock): ItemStock {
  return { ...fila, alerta: tipoAlerta(fila) };
}

/**
 * HU-015 (BL-120): stock de la jornada y alertas de stock bajo.
 *
 * - Solo el Administrador lo usa (el controller lo restringe).
 * - Todo dentro del contexto del tenant (RLS) y con tenantId en el filtro.
 * - Un ajuste y su auditoría van en la misma transacción (HU-035): si una
 *   falla, no queda ninguna de las dos.
 * - Con control de stock, la disponibilidad sigue al stock: en 0 el ítem no
 *   se puede pedir y al reponer vuelve a la carta (D6).
 * - Las alertas no se guardan: son el estado actual de los ítems (D4).
 */
@Injectable()
export class StockService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Los ítems de la carta, por categoría y en el orden de la carta. */
  listar(tenantId: string): Promise<ItemStock[]> {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const filas = await tx.itemCarta.findMany({
        where: { tenantId, ...DE_LA_CARTA },
        select: SELECT_ITEM_STOCK,
        orderBy: [
          { categoria: { orden: 'asc' } },
          { orden: 'asc' },
          { nombre: 'asc' },
        ],
      });
      return filas.map(aItemStock);
    });
  }

  /** Los ítems en alerta: los agotados primero, después los de menos stock. */
  alertas(tenantId: string): Promise<AlertaStock[]> {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const filas = await tx.itemCarta.findMany({
        where: { tenantId, controlaStock: true, ...DE_LA_CARTA },
        select: {
          id: true,
          nombre: true,
          controlaStock: true,
          stockActual: true,
          umbralAlerta: true,
        },
      });
      return filas
        .map((fila) => ({ fila, tipo: tipoAlerta(fila) }))
        .filter(
          (x): x is { fila: (typeof filas)[number]; tipo: TipoAlertaStock } =>
            x.tipo !== null,
        )
        .map(({ fila, tipo }) => ({
          itemId: fila.id,
          nombre: fila.nombre,
          stockActual: fila.stockActual,
          umbralAlerta: fila.umbralAlerta,
          tipo,
        }))
        .sort(compararAlertas);
    });
  }

  /**
   * Carga de la jornada o reposición: cambia lo que viene de cada ítem y
   * devuelve cómo quedaron. 400 si un ítem se repite; 404 si alguno no es
   * de la carta de este establecimiento.
   */
  async ajustar(
    tenantId: string,
    dto: AjustarStockDto,
    actor: { id: string },
  ): Promise<ResultadoAjusteStock> {
    const ids = dto.items.map((a) => a.itemId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Un ítem aparece más de una vez');
    }

    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const actuales = await tx.itemCarta.findMany({
        where: { tenantId, id: { in: ids }, ...DE_LA_CARTA },
        select: SELECT_ITEM_STOCK,
      });
      if (actuales.length !== ids.length) {
        throw new NotFoundException(
          'Algún ítem no existe en la carta de este establecimiento',
        );
      }
      const porId = new Map(actuales.map((item) => [item.id, item]));

      const items: ItemStock[] = [];
      const disponibilidadCambiada: ResultadoAjusteStock['disponibilidadCambiada'] =
        [];
      for (const ajuste of dto.items) {
        const antes = porId.get(ajuste.itemId) as FilaItemStock;
        const stock: StockDeItem = {
          controlaStock: ajuste.controlaStock ?? antes.controlaStock,
          stockActual: ajuste.stockActual ?? antes.stockActual,
          umbralAlerta: ajuste.umbralAlerta ?? antes.umbralAlerta,
        };
        const despues = {
          ...stock,
          disponible: disponibleTrasAjuste(stock, antes.disponible),
        };
        const cambios = camposCambiados(antes, despues);
        if (cambios.length === 0) {
          items.push(aItemStock(antes));
          continue;
        }

        // Secuencial a propósito (Sonar S9382): una transacción, una
        // conexión; son pocos ítems y cada uno lleva su auditoría.
        const actualizado = await /* NOSONAR */ tx.itemCarta.update({
          where: { id: antes.id },
          data: despues,
          select: SELECT_ITEM_STOCK,
        });
        await /* NOSONAR */ this.auditLog.registrarEnTx(tx, {
          action: AuditAction.CARTA_ITEM_STOCK_AJUSTADO,
          tenantId,
          actorKeycloakId: actor.id,
          entidadId: antes.id,
          antes: soloCampos(antes, cambios),
          despues: soloCampos(despues, cambios),
          detalle: { nombre: antes.nombre },
        });
        if (despues.disponible !== antes.disponible) {
          disponibilidadCambiada.push({
            itemId: antes.id,
            disponible: despues.disponible,
          });
        }
        items.push(aItemStock(actualizado));
      }
      return { items, disponibilidadCambiada };
    });
  }
}

const CAMPOS_AUDITADOS = [
  'controlaStock',
  'stockActual',
  'umbralAlerta',
  'disponible',
] as const;
type CampoAuditado = (typeof CAMPOS_AUDITADOS)[number];

function camposCambiados(
  antes: Record<CampoAuditado, unknown>,
  despues: Record<CampoAuditado, unknown>,
): CampoAuditado[] {
  return CAMPOS_AUDITADOS.filter((campo) => antes[campo] !== despues[campo]);
}

function soloCampos(
  valores: Record<CampoAuditado, unknown>,
  campos: CampoAuditado[],
): Record<string, unknown> {
  return Object.fromEntries(campos.map((campo) => [campo, valores[campo]]));
}
