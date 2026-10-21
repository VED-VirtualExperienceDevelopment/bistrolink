import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export const TAMANO_PAGINA_ESTABLECIMIENTOS = 20;

/** BL-406: largo máximo del texto de búsqueda (lo controla el controller). */
export const MAX_LARGO_BUSQUEDA = 100;

export interface EstablecimientoListado {
  tenantId: string;
  razonSocial: string;
  rut: string;
  plan: string;
  /** Username del usuario de plataforma o "script:<usuario>"; null si no hay registro. */
  creadoPor: string | null;
  creadoEl: Date;
  /** null si el alta quedó a medias (tenant sin restaurante). */
  restaurante: { id: string; nombre: string } | null;
}

export interface PaginaEstablecimientos {
  pagina: number;
  tamanoPagina: number;
  total: number;
  items: EstablecimientoListado[];
}

/**
 * BL-406: condición de búsqueda sobre `tenant`.
 *
 * - Texto: razón social que lo contiene, sin distinguir mayúsculas.
 * - Si, sin espacios, puntos ni guiones, son solo dígitos, también busca RUT
 *   que empiecen con esos dígitos («21 0000» o «21.0000» encuentran
 *   «210000000001»).
 *
 * Solo campos de `tenant`, que no tiene RLS. El nombre del restaurante NO se
 * busca acá: `restaurante` tiene RLS forzado y buscar en los de todos los
 * tenants a la vez obligaría a saltearlo.
 *
 * Prisma arma la consulta con parámetros: el texto nunca se concatena al SQL.
 */
export function condicionBusqueda(
  busqueda?: string,
): Prisma.TenantWhereInput | undefined {
  const texto = busqueda?.trim();
  if (!texto) return undefined;

  const porRazonSocial: Prisma.TenantWhereInput = {
    razonSocial: { contains: texto, mode: 'insensitive' },
  };
  const digitos = texto.replaceAll(/[\s.-]/g, '');
  if (/^\d+$/.test(digitos)) {
    return { OR: [{ rut: { startsWith: digitos } }, porRazonSocial] };
  }
  return porRazonSocial;
}

/**
 * BL-163 (HU-027): listado de establecimientos para el rol PLATAFORMA.
 *
 * `tenant` no tiene RLS (es la raíz del aislamiento): la página se lee en una
 * consulta. `restaurante` sí tiene RLS forzado, así que el restaurante de cada
 * tenant se lee dentro del contexto de ESE tenant, uno por vez. No se agrega
 * ninguna vía para saltear las políticas; por eso el listado va paginado.
 *
 * BL-406: búsqueda opcional por razón social o RUT (condicionBusqueda). El
 * total cuenta solo los que coinciden, así la paginación sigue siendo
 * correcta.
 */
@Injectable()
export class EstablecimientosService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async listar(
    pagina: number,
    busqueda?: string,
  ): Promise<PaginaEstablecimientos> {
    const tamanoPagina = TAMANO_PAGINA_ESTABLECIMIENTOS;
    const where = condicionBusqueda(busqueda);

    // runInTenantContext exige un tenantId: uno provisorio que no corresponde
    // a ningún dato (mismo criterio que la búsqueda por RUT del alta).
    const { total, tenants } = await this.tenantPrisma.runInTenantContext(
      randomUUID(),
      async (tx) => ({
        total: await tx.tenant.count({ where }),
        tenants: await tx.tenant.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (pagina - 1) * tamanoPagina,
          take: tamanoPagina,
          select: {
            id: true,
            razonSocial: true,
            rut: true,
            plan: true,
            creadoPor: true,
            createdAt: true,
          },
        }),
      }),
    );

    const items: EstablecimientoListado[] = [];
    for (const tenant of tenants) {
      const restaurante = await this.tenantPrisma.runInTenantContext(
        tenant.id,
        (tx) =>
          tx.restaurante.findUnique({
            where: { tenantId: tenant.id },
            select: { id: true, nombre: true },
          }),
      );
      items.push({
        tenantId: tenant.id,
        razonSocial: tenant.razonSocial,
        rut: tenant.rut,
        plan: tenant.plan,
        creadoPor: tenant.creadoPor,
        creadoEl: tenant.createdAt,
        restaurante,
      });
    }

    return { pagina, tamanoPagina, total, items };
  }
}
