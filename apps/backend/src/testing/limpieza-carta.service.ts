import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import {
  CATEGORIAS_DEL_SEED,
  ITEMS_DEL_SEED,
  MARCA_ITEM_E2E,
  PREFIJO_CATEGORIA_E2E,
  STOCK_DEL_SEED,
} from './datos-seed';

/** Resumen del área `carta` (lo que responde la API). */
export interface ResumenCarta {
  /** Ítems de prueba sin pedidos: borrados. */
  itemsEliminados: number;
  /** Ítems de prueba con pedidos: archivados (la base no deja borrarlos). */
  itemsArchivados: number;
  /** Categorías «E2E …» que quedaron vacías: borradas. */
  categoriasEliminadas: number;
  /** Categorías «E2E …» con ítems archivados: archivadas. */
  categoriasArchivadas: number;
  /** Ítems y categorías del seed que volvieron a sus valores. */
  seedRestablecido: number;
}

export interface ResultadoLimpiezaCarta extends ResumenCarta {
  /** Para avisar a la carta del comensal y a Gestión de Carta. */
  itemsRetirados: string[];
  categoriasRetiradas: string[];
  /** Hubo cambios en el seed (la carta y la campana de stock se recargan). */
  seedCambio: boolean;
}

interface ItemLeido {
  id: string;
  nombre: string;
  categoriaId: string;
  precio: Prisma.Decimal;
  disponible: boolean;
  archivadoEn: Date | null;
  controlaStock: boolean;
  stockActual: number;
  umbralAlerta: number;
  _count: { lineasPedido: number };
}

interface CategoriaLeida {
  id: string;
  nombre: string;
  activo: boolean;
  archivadaEn: Date | null;
}

/** Ítem de prueba: en una categoría «E2E …» o con «E2E» en el nombre. */
export function esItemDePrueba(
  item: Pick<ItemLeido, 'id' | 'nombre' | 'categoriaId'>,
  categoriasDePrueba: ReadonlySet<string>,
): boolean {
  if (ITEMS_DEL_SEED.some((s) => s.id === item.id)) return false;
  return (
    categoriasDePrueba.has(item.categoriaId) || MARCA_ITEM_E2E.test(item.nombre)
  );
}

/** Lo que hay que cambiar de un ítem del seed, o null si ya está como el seed. */
export function cambiosItemDelSeed(
  item: Omit<ItemLeido, 'nombre' | '_count'>,
): Prisma.ItemCartaUpdateInput | null {
  const seed = ITEMS_DEL_SEED.find((s) => s.id === item.id);
  if (!seed) return null;
  const igual =
    item.categoriaId === seed.categoriaId &&
    new Prisma.Decimal(item.precio).equals(seed.precio) &&
    item.disponible === seed.disponible &&
    item.archivadoEn === null &&
    item.controlaStock === STOCK_DEL_SEED.controlaStock &&
    item.stockActual === STOCK_DEL_SEED.stockActual &&
    item.umbralAlerta === STOCK_DEL_SEED.umbralAlerta;
  if (igual) return null;
  return {
    categoria: { connect: { id: seed.categoriaId } },
    precio: seed.precio,
    disponible: seed.disponible,
    archivadoEn: null,
    ...STOCK_DEL_SEED,
  };
}

/**
 * BL-480 (BL-285, ADR 0011): deja la carta y el stock del tenant como el
 * seed.
 *
 * - Ítems de prueba (en categorías «E2E …» o con «E2E» en el nombre): se
 *   borran; si tienen pedidos, se archivan (la base no deja borrarlos).
 * - Categorías «E2E …»: se borran si quedaron vacías; si no, se archivan.
 * - Ítems y categorías del seed: vuelven a sus valores (precio,
 *   disponibilidad, sin control de stock, activos).
 * - Lo demás de la carta no se toca. Las imágenes no se borran del bucket
 *   (igual que al eliminar un ítem desde Gestión de Carta).
 */
@Injectable()
export class LimpiezaCartaService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async limpiar(
    tenantId: string,
    actorKeycloakId: string,
    dryRun: boolean,
  ): Promise<ResultadoLimpiezaCarta> {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const categorias: CategoriaLeida[] = await tx.categoriaCarta.findMany({
        select: { id: true, nombre: true, activo: true, archivadaEn: true },
      });
      const items: ItemLeido[] = await tx.itemCarta.findMany({
        select: {
          id: true,
          nombre: true,
          categoriaId: true,
          precio: true,
          disponible: true,
          archivadoEn: true,
          controlaStock: true,
          stockActual: true,
          umbralAlerta: true,
          _count: { select: { lineasPedido: true } },
        },
      });

      const plan = planificar(categorias, items);
      const resumen: ResumenCarta = {
        itemsEliminados: plan.itemsABorrar.length,
        itemsArchivados: plan.itemsAArchivar.length,
        categoriasEliminadas: plan.categoriasABorrar.length,
        categoriasArchivadas: plan.categoriasAArchivar.length,
        seedRestablecido:
          plan.itemsDelSeed.length + plan.categoriasDelSeed.length,
      };
      const sinCambios = Object.values(resumen).every((n) => n === 0);
      if (dryRun || sinCambios) {
        return {
          ...resumen,
          itemsRetirados: [],
          categoriasRetiradas: [],
          seedCambio: false,
        };
      }

      await this.aplicar(tx, plan);
      await this.auditLog.registrarEnTx(tx, {
        action: AuditAction.CARTA_ITEM_LIMPIEZA_PRUEBAS,
        tenantId,
        actorKeycloakId,
        detalle: { motivo: 'limpieza de datos de prueba (BL-285)', ...resumen },
      });

      return {
        ...resumen,
        itemsRetirados: [...plan.itemsABorrar, ...plan.itemsAArchivar],
        categoriasRetiradas: [
          ...plan.categoriasABorrar,
          ...plan.categoriasAArchivar,
        ],
        seedCambio: resumen.seedRestablecido > 0,
      };
    });
  }

  private async aplicar(tx: PrismaClient, plan: PlanCarta) {
    const ahora = new Date();
    if (plan.itemsABorrar.length > 0) {
      await tx.itemCarta.deleteMany({
        where: { id: { in: plan.itemsABorrar } },
      });
    }
    if (plan.itemsAArchivar.length > 0) {
      await tx.itemCarta.updateMany({
        where: { id: { in: plan.itemsAArchivar } },
        data: { archivadoEn: ahora },
      });
    }
    if (plan.categoriasABorrar.length > 0) {
      await tx.categoriaCarta.deleteMany({
        where: { id: { in: plan.categoriasABorrar } },
      });
    }
    if (plan.categoriasAArchivar.length > 0) {
      await tx.categoriaCarta.updateMany({
        where: { id: { in: plan.categoriasAArchivar } },
        data: { archivadaEn: ahora },
      });
    }
    if (plan.categoriasDelSeed.length > 0) {
      await tx.categoriaCarta.updateMany({
        where: { id: { in: plan.categoriasDelSeed } },
        data: { activo: true, archivadaEn: null },
      });
    }
    // Secuencial a propósito (Sonar S9382): misma transacción, una sola
    // conexión, y son los pocos ítems del seed (cada uno con sus valores).
    for (const { id, data } of plan.itemsDelSeed) {
      await /* NOSONAR */ tx.itemCarta.update({ where: { id }, data });
    }
  }
}

interface PlanCarta {
  itemsABorrar: string[];
  itemsAArchivar: string[];
  categoriasABorrar: string[];
  categoriasAArchivar: string[];
  categoriasDelSeed: string[];
  itemsDelSeed: { id: string; data: Prisma.ItemCartaUpdateInput }[];
}

/** Qué hacer con cada ítem y categoría. Exportada para los tests. */
export function planificar(
  categorias: CategoriaLeida[],
  items: ItemLeido[],
): PlanCarta {
  const categoriasDePrueba = new Set(
    categorias
      .filter((c) => c.nombre.startsWith(PREFIJO_CATEGORIA_E2E))
      .filter((c) => !CATEGORIAS_DEL_SEED.includes(c.id))
      .map((c) => c.id),
  );
  const dePrueba = items.filter((i) => esItemDePrueba(i, categoriasDePrueba));
  const itemsABorrar = dePrueba
    .filter((i) => i._count.lineasPedido === 0)
    .map((i) => i.id);
  const itemsAArchivar = dePrueba
    .filter((i) => i._count.lineasPedido > 0 && i.archivadoEn === null)
    .map((i) => i.id);

  // Una categoría de prueba se puede borrar si no le queda ningún ítem
  // (los archivados con pedidos siguen siendo suyos).
  const conItemsQueQuedan = new Set(
    items.filter((i) => !itemsABorrar.includes(i.id)).map((i) => i.categoriaId),
  );
  const categoriasABorrar = [...categoriasDePrueba].filter(
    (id) => !conItemsQueQuedan.has(id),
  );
  const categoriasAArchivar = categorias
    .filter(
      (c) =>
        categoriasDePrueba.has(c.id) &&
        conItemsQueQuedan.has(c.id) &&
        c.archivadaEn === null,
    )
    .map((c) => c.id);

  const categoriasDelSeed = categorias
    .filter(
      (c) =>
        CATEGORIAS_DEL_SEED.includes(c.id) &&
        (!c.activo || c.archivadaEn !== null),
    )
    .map((c) => c.id);
  const itemsDelSeed = items.flatMap((i) => {
    const data = cambiosItemDelSeed(i);
    return data ? [{ id: i.id, data }] : [];
  });

  return {
    itemsABorrar,
    itemsAArchivar,
    categoriasABorrar,
    categoriasAArchivar,
    categoriasDelSeed,
    itemsDelSeed,
  };
}
