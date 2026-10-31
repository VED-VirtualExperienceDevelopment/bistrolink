import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { StorageService } from './storage.service';
import { mapItemToDto } from './menu.mapper';

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

      const categoriasConUrls =
        await this.categoriasConUrlsFirmadas(categorias);

      return {
        restaurante: { nombre: mesa.restaurante.nombre },
        categorias: categoriasConUrls,
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

      const categoriasConUrls =
        await this.categoriasConUrlsFirmadas(categorias);

      return {
        restaurante: {
          id: restaurante.id,
          nombre: restaurante.nombre,
          direccion: restaurante.direccion,
        },
        categorias: categoriasConUrls,
      };
    });
  }

  private async categoriasConUrlsFirmadas(categorias: any[]) {
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
            return mapItemToDto(item, imagenUrl);
          }),
        ),
      })),
    );
  }
}
