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

      const categoriasConUrls =
        await this.categoriasConUrlsFirmadas(categorias);

      return {
        restaurante: {
          nombre: mesa.restaurante.nombre,
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
    // SEGURIDAD: runInTenantContext establece app.tenant_id como variable de sesión de PostgreSQL.
    // Todas las queries dentro de este callback están aisladas a este tenant.
    // RLS en la base de datos actúa como segunda línea de defensa (defensa en profundidad).
    // Si restauranteId pertenece a otro tenant, RLS lo filtra y findUnique devuelve null.
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const restaurante = await tx.restaurante.findUnique({
        where: { id: restauranteId },
      });

      if (!restaurante) {
        throw new NotFoundException(
          'Restaurante no encontrado para este establecimiento',
        );
      }

      // Decisión de negocio HU-002: para pedidos "para llevar" se muestran
      // solo los items disponibles. A diferencia de HU-001, donde los no
      // disponibles se muestran bloqueados visualmente (ver menu.mapper.ts).
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

  /**
   * Arma las categorías con URLs firmadas de S3 para las imágenes.
   * El mapeo de cada item se delega a `mapItemToDto` (menu.mapper.ts,
   * introducido en BL-25) para no duplicar esa lógica y mantener un
   * único estándar de mapeo en el módulo.
   */
  private async categoriasConUrlsFirmadas(categorias: any[]) {
    return Promise.all(
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
    );
  }
}
