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
        where: { restauranteId: mesa.restauranteId },
        orderBy: { orden: 'asc' },
        include: {
          items: { orderBy: { nombre: 'asc' } },
        },
      });

      const categoriasConUrls = await Promise.all(
        categorias.map(async (categoria) => ({
          id: categoria.id,
          nombre: categoria.nombre,
          items: await Promise.all(
            categoria.items.map(async (item) => {
                const imagenUrl = item.imagenKey
                ? await this.storage.getSignedImageUrl(item.imagenKey)
                : null;
                return mapItemToDto(item, imagenUrl);
            }),
            ),
        })),
        )

      return {
        restaurante: {
          nombre: mesa.restaurante.nombre,
        },
        categorias: categoriasConUrls,
      };
    });
  }
}
