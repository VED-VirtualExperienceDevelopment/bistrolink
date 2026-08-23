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
        include: {
          items: { orderBy: { nombre: 'asc' } },
        },
      });

      const categoriasConUrls = await Promise.all(
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

      return {
        restaurante: {
          nombre: mesa.restaurante.nombre,
          direccion: mesa.restaurante.direccion,
        },
        categorias: categoriasConUrls,
      };
    });
  }

  /**
   * HU-002: Obtiene el menú completo de un restaurante para acceso público.
   * No requiere mesaId porque es para pedidos desde fuera del local.
   */
  async getMenuByRestaurante(tenantId: string, restauranteId: string) {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      // 1. Buscar el restaurante directamente (sin pasar por mesa)
      const restaurante = await tx.restaurante.findUnique({
        where: { id: restauranteId },
      });

      // 2. Validar que el restaurante exista
      if (!restaurante) {
        throw new NotFoundException(
          'Restaurante no encontrado para este establecimiento',
        );
      }

      // 3. Obtener categorías con sus items (solo disponibles)
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

      // 4. Generar URLs firmadas para las imágenes
      const categoriasConUrls = await Promise.all(
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

      // 5. Respuesta con el id del restaurante incluido
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
}
