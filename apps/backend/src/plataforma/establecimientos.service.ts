import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { tieneActividad } from './eliminacion-establecimiento.service';

export const TAMANO_PAGINA_ESTABLECIMIENTOS = 20;

/** BL-406: largo máximo del texto de búsqueda (lo controla el controller). */
export const MAX_LARGO_BUSQUEDA = 100;

/**
 * BL-410: estado que muestra el listado, uno por establecimiento:
 *
 * - SUSPENDIDO: `tenant.estado` es SUSPENDIDO (aunque el alta esté a medias:
 *   lo primero que hay que saber es que no opera).
 * - ALTA_INCOMPLETA: activo y sin `alta_completada_en`.
 * - ACTIVO: activo y con el alta completa.
 */
export type EstadoEstablecimiento = 'ACTIVO' | 'SUSPENDIDO' | 'ALTA_INCOMPLETA';

/** BL-410: valores del filtro `estado` del listado (en plural, como en la pantalla). */
export const FILTROS_ESTADO = [
  'ACTIVOS',
  'SUSPENDIDOS',
  'ALTA_INCOMPLETA',
] as const;
export type FiltroEstado = (typeof FILTROS_ESTADO)[number];

export function esFiltroEstado(valor: unknown): valor is FiltroEstado {
  return FILTROS_ESTADO.includes(valor as FiltroEstado);
}

/**
 * BL-410: estado de un tenant para el listado. Es la misma regla que
 * condicionEstado: lo que filtra cada opción es exactamente lo que se
 * muestra con ese estado.
 */
export function estadoDelEstablecimiento(tenant: {
  estado: 'ACTIVO' | 'SUSPENDIDO';
  altaCompletadaEn: Date | null;
}): EstadoEstablecimiento {
  if (tenant.estado === 'SUSPENDIDO') return 'SUSPENDIDO';
  return tenant.altaCompletadaEn ? 'ACTIVO' : 'ALTA_INCOMPLETA';
}

/**
 * BL-410: condición del filtro por estado, solo sobre columnas de `tenant`
 * (sin leer `restaurante`, que tiene RLS forzado).
 */
export function condicionEstado(
  filtro?: FiltroEstado,
): Prisma.TenantWhereInput | undefined {
  switch (filtro) {
    case 'ACTIVOS':
      return { estado: 'ACTIVO', altaCompletadaEn: { not: null } };
    case 'SUSPENDIDOS':
      return { estado: 'SUSPENDIDO' };
    case 'ALTA_INCOMPLETA':
      return { estado: 'ACTIVO', altaCompletadaEn: null };
    default:
      return undefined;
  }
}

export interface EstablecimientoListado {
  tenantId: string;
  razonSocial: string;
  rut: string;
  plan: string;
  /** Username del usuario de plataforma o "script:<usuario>"; null si no hay registro. */
  creadoPor: string | null;
  creadoEl: Date;
  /** null si el tenant todavía no tiene restaurante. */
  restaurante: { id: string; nombre: string } | null;
  /** BL-410: ver estadoDelEstablecimiento. */
  estado: EstadoEstablecimiento;
  /** BL-418: sin ningún pedido, se puede eliminar (ver tieneActividad). */
  eliminable: boolean;
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
 * BL-410: junta las condiciones de búsqueda y de estado. Con una sola, la
 * devuelve tal cual; sin ninguna, undefined (no filtra).
 */
export function combinarCondiciones(
  ...condiciones: (Prisma.TenantWhereInput | undefined)[]
): Prisma.TenantWhereInput | undefined {
  const presentes = condiciones.filter(
    (c): c is Prisma.TenantWhereInput => c !== undefined,
  );
  if (presentes.length === 0) return undefined;
  if (presentes.length === 1) return presentes[0];
  return { AND: presentes };
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
 *
 * BL-410: filtro opcional por estado (condicionEstado), que se combina con
 * la búsqueda. Cada fila trae su estado, calculado con la misma regla.
 *
 * BL-418: cada fila dice si se puede eliminar. Se calcula en el mismo
 * contexto en que se lee el restaurante (una consulta más por fila, con
 * LIMIT 1).
 */
@Injectable()
export class EstablecimientosService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async listar(
    pagina: number,
    busqueda?: string,
    estado?: FiltroEstado,
  ): Promise<PaginaEstablecimientos> {
    const tamanoPagina = TAMANO_PAGINA_ESTABLECIMIENTOS;
    const where = combinarCondiciones(
      condicionBusqueda(busqueda),
      condicionEstado(estado),
    );

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
            estado: true,
            altaCompletadaEn: true,
          },
        }),
      }),
    );

    const items: EstablecimientoListado[] = [];
    for (const tenant of tenants) {
      const { restaurante, eliminable } =
        await this.tenantPrisma.runInTenantContext(tenant.id, async (tx) => ({
          restaurante: await tx.restaurante.findUnique({
            where: { tenantId: tenant.id },
            select: { id: true, nombre: true },
          }),
          eliminable: !(await tieneActividad(tx, tenant.id)),
        }));
      items.push({
        tenantId: tenant.id,
        razonSocial: tenant.razonSocial,
        rut: tenant.rut,
        plan: tenant.plan,
        creadoPor: tenant.creadoPor,
        creadoEl: tenant.createdAt,
        restaurante,
        estado: estadoDelEstablecimiento(tenant),
        eliminable,
      });
    }

    return { pagina, tamanoPagina, total, items };
  }
}
