import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { StorageService } from './storage.service';
import { mapItemToDto } from './menu.mapper';
import { platosMasPedidos, type ConsultaCruda } from './mas-pedidos';
import type { PlantillaMarca } from '../configuracion/plantillas-marca';

/**
 * HU-043 (BL-532): marca del local en la carta del comensal. El logo sale
 * por la CDN en staging y producción, y firmado en local (urlImagenPublica).
 */
export interface MarcaPublica {
  /** null si el local no tiene logo: la carta muestra el nombre. */
  logoUrl: string | null;
  /** HU-043 (BL-562): null = la portada por defecto del banner. */
  portadaUrl: string | null;
  plantilla: PlantillaMarca;
}
import { retiroPublico } from '../pedidos/retiro';

/**
 * BL-397 (decisión 2 de la propuesta de la carta): el comensal ve lo mismo
 * por QR (HU-001) y por URL directa (HU-002). Categorías visibles y no
 * archivadas; ítems no archivados, incluidos los agotados, que el frontend
 * muestra marcados y bloqueados (MenuDigital). Orden manual de la carta y,
 * a igual orden, alfabético.
 */
export const FILTRO_CATEGORIAS_DEL_COMENSAL = {
  activo: true,
  archivadaEn: null,
} as const;

export const ITEMS_DEL_COMENSAL = {
  where: { archivadoEn: null },
  orderBy: [{ orden: 'asc' as const }, { nombre: 'asc' as const }],
};

@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly storage: StorageService,
  ) {}

  async getMenuByMesa(tenantId: string, mesaId: string) {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const mesa = await tx.mesa.findUnique({
        where: { id: mesaId },
        include: { restaurante: true },
      });

      if (!mesa) {
        throw new NotFoundException(
          'Mesa no encontrada para este establecimiento',
        );
      }

      const categorias = await tx.categoriaCarta.findMany({
        where: {
          restauranteId: mesa.restauranteId,
          ...FILTRO_CATEGORIAS_DEL_COMENSAL,
        },
        orderBy: { orden: 'asc' },
        include: { items: ITEMS_DEL_COMENSAL },
      });

      const categoriasConUrls = await this.categoriasConUrlsFirmadas(
        categorias,
        await this.masPedidosDe(tx, tenantId, categorias),
      );

      return {
        restaurante: { nombre: mesa.restaurante.nombre },
        marca: await this.marcaDe(mesa.restaurante),
        categorias: categoriasConUrls,
      };
    });
  }

  /**
   * HU-036 (BL-206): datos del responsable de los datos personales (el
   * establecimiento) para su política de privacidad: nombre del local,
   * razón social, RUT, dirección y correo para ejercer los derechos. El RUT
   * y la razón social ya figuran en cada e-Ticket. Si se pasa el
   * restaurante, tiene que ser el del tenant (404 genérico si no).
   */
  async getPrivacidad(tenantId: string, restauranteId?: string) {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const restaurante = await tx.restaurante.findUnique({
        where: { tenantId },
        select: {
          id: true,
          nombre: true,
          direccion: true,
          emailPrivacidad: true,
          tenant: { select: { razonSocial: true, rut: true } },
        },
      });
      if (!restaurante || (restauranteId && restaurante.id !== restauranteId)) {
        throw new NotFoundException(
          'Restaurante no encontrado para este establecimiento',
        );
      }
      return {
        establecimiento: {
          nombre: restaurante.nombre,
          razonSocial: restaurante.tenant.razonSocial,
          rut: restaurante.tenant.rut,
          direccion: restaurante.direccion,
          emailPrivacidad: restaurante.emailPrivacidad,
        },
      };
    });
  }

  async getMenuByRestaurante(tenantId: string, restauranteId: string) {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const restaurante = await tx.restaurante.findUnique({
        where: { id: restauranteId },
      });

      if (!restaurante) {
        throw new NotFoundException(
          'Restaurante no encontrado para este establecimiento',
        );
      }

      // BL-397: antes esta ruta ocultaba los agotados y la del QR los
      // mostraba bloqueados (C5). Ahora las dos usan el mismo criterio.
      const categorias = await tx.categoriaCarta.findMany({
        where: {
          restauranteId,
          ...FILTRO_CATEGORIAS_DEL_COMENSAL,
        },
        orderBy: { orden: 'asc' },
        include: { items: ITEMS_DEL_COMENSAL },
      });

      const categoriasConUrls = await this.categoriasConUrlsFirmadas(
        categorias,
        await this.masPedidosDe(tx, tenantId, categorias),
      );

      return {
        restaurante: {
          id: restaurante.id,
          nombre: restaurante.nombre,
          direccion: restaurante.direccion,
        },
        marca: await this.marcaDe(restaurante),
        // HU-040 (BL-210): este enlace es el de los pedidos para retirar.
        // Si el local no los toma ahora, la carta se muestra igual pero sin
        // poder pedir (y POST /pedidos responde 409).
        retiro: retiroPublico(restaurante, new Date(), restaurante.timezone),
        categorias: categoriasConUrls,
      };
    });
  }

  /** HU-043 (BL-532 y BL-562): el logo, la portada y la plantilla del local. */
  private async marcaDe(restaurante: {
    logoKey: string | null;
    portadaKey: string | null;
    plantilla: string;
  }): Promise<MarcaPublica> {
    return {
      logoUrl: restaurante.logoKey
        ? await this.storage.urlImagenPublica(restaurante.logoKey)
        : null,
      portadaUrl: restaurante.portadaKey
        ? await this.storage.urlImagenPublica(restaurante.portadaKey)
        : null,
      // La columna es texto (con CHECK): acá se acota al tipo.
      plantilla: restaurante.plantilla as PlantillaMarca,
    };
  }

  /**
   * HU-045 (BL-547): los «más pedidos» entre los platos de esta carta, en la
   * misma transacción (RLS). Si la consulta falla, la carta se muestra igual,
   * sin la insignia: es un dato de ayuda, no algo para pedir.
   */
  private async masPedidosDe(
    tx: ConsultaCruda,
    tenantId: string,
    categorias: { items: { id: string }[] }[],
  ): Promise<ReadonlySet<string>> {
    const ids = categorias.flatMap((c) => c.items.map((i) => i.id));
    try {
      return new Set(await platosMasPedidos(tx, tenantId, ids));
    } catch (error) {
      // Solo lectura: la carta sigue (y la transacción no escribió nada).
      this.logger.warn(
        `No se pudieron calcular los platos más pedidos: ${(error as Error).message}`,
      );
      return new Set();
    }
  }

  private async categoriasConUrlsFirmadas(
    categorias: any[],
    masPedidos: ReadonlySet<string> = new Set(),
  ) {
    return Promise.all(
      categorias.map(async (categoria) => ({
        id: categoria.id,
        nombre: categoria.nombre,
        activo: categoria.activo, // <-- ¡CORRECCIÓN CLAVE! Ahora sí se expone el campo
        items: await Promise.all(
          categoria.items.map(async (item) => {
            const imagenUrl = item.imagenKey
              ? await this.storage.urlImagenPublica(item.imagenKey)
              : null;
            return mapItemToDto(item, imagenUrl, masPedidos.has(item.id));
          }),
        ),
      })),
    );
  }
}
