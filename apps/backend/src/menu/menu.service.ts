import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { StorageService } from './storage.service';

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
        where: { restauranteId: mesa.restauranteId },
        orderBy: { orden: 'asc' },
        include: { items: { orderBy: { nombre: 'asc' } } },
      });

      const categoriasConUrls = await this.armarCategoriasConUrls(categorias);

      return {
        restaurante: {
          nombre: mesa.restaurante.nombre,
          direccion: mesa.restaurante.direccion,
        },
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

      const categorias = await tx.categoriaCarta.findMany({
        where: { restauranteId },
        orderBy: { orden: 'asc' },
        include: {
          items: {
            where: { disponible: true },
            orderBy: { nombre: 'asc' },
          },
        },
      });

      const categoriasConUrls = await this.armarCategoriasConUrls(categorias);

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

  /**
   * Helper privado que arma el array de categorías con URLs firmadas de S3.
   * Reutilizado por ambos endpoints (HU-001 y HU-002) para evitar duplicación.
   */
  private async armarCategoriasConUrls(categorias: any[]) {
    return Promise.all(
      categorias.map(async (categoria) => ({
        id: categoria.id,
        nombre: categoria.nombre,
        items: await Promise.all(
          categoria.items.map(async (item) => ({
            id: item.id,
            nombre: item.nombre,
            descripcion: item.descripcion,
            precio: item.precio,
            disponible: item.disponible,
            imagenUrl: item.imagenKey
              ? await this.storage.getSignedImageUrl(item.imagenKey)
              : null,
          })),
        ),
      })),
    );
  }
}
