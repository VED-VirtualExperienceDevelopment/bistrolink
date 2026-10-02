import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { StorageService } from './storage.service';
import { mapItemToDto } from './menu.mapper';

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
          activo: true,
        },
        orderBy: { orden: 'asc' },
        include: {
          items: {
            where: { disponible: true },
            orderBy: { nombre: 'asc' },
          },
        },
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

      const categorias = await tx.categoriaCarta.findMany({
        where: {
          restauranteId,
          activo: true,
        },
        orderBy: { orden: 'asc' },
        include: {
          items: {
            where: { disponible: true },
            orderBy: { nombre: 'asc' },
          },
        },
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
              ? await this.storage.getSignedImageUrl(item.imagenKey)
              : null;
            return mapItemToDto(item, imagenUrl);
          }),
        ),
      })),
    );
  }
}
