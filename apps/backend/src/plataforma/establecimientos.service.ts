import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export const TAMANO_PAGINA_ESTABLECIMIENTOS = 20;

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
 * BL-163 (HU-027): listado de establecimientos para el rol PLATAFORMA.
 *
 * `tenant` no tiene RLS (es la raíz del aislamiento): la página se lee en una
 * consulta. `restaurante` sí tiene RLS forzado, así que el restaurante de cada
 * tenant se lee dentro del contexto de ESE tenant, uno por vez. No se agrega
 * ninguna vía para saltear las políticas; por eso el listado va paginado.
 */
@Injectable()
export class EstablecimientosService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async listar(pagina: number): Promise<PaginaEstablecimientos> {
    const tamanoPagina = TAMANO_PAGINA_ESTABLECIMIENTOS;

    // runInTenantContext exige un tenantId: uno provisorio que no corresponde
    // a ningún dato (mismo criterio que la búsqueda por RUT del alta).
    const { total, tenants } = await this.tenantPrisma.runInTenantContext(
      randomUUID(),
      async (tx) => ({
        total: await tx.tenant.count(),
        tenants: await tx.tenant.findMany({
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
