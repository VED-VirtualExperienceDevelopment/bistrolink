import { Injectable, NotFoundException, Logger, UnauthorizedException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { MenuGateway } from './menu.gateway';
import { UpdateItemDto } from './dto/update-item.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';

@Injectable()
export class MenuAdminService {
  private readonly logger = new Logger(MenuAdminService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly menuGateway: MenuGateway,
  ) {}

  private async resolveRestauranteId(
    tenantId: string,
    restauranteId: string | undefined,
    keycloakId: string,
  ): Promise<string> {
    if (restauranteId) return restauranteId;

    const result = await this.prisma.runInTenantContext(tenantId, async (tx) => {
      return await tx.usuario.findFirst({
        where: { keycloakId },
        select: { restauranteId: true },
      });
    });

    if (!result?.restauranteId) {
      throw new UnauthorizedException(
        'No se pudo determinar el restaurante del usuario. Verifica tu configuración de Keycloak o la tabla Usuario.',
      );
    }

    return result.restauranteId;
  }

  async findAllCategorias(
    tenantId: string,
    restauranteId: string | undefined,
    keycloakId: string,
  ) {
    const finalRestauranteId = await this.resolveRestauranteId(
      tenantId,
      restauranteId,
      keycloakId,
    );

    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      return await tx.categoriaCarta.findMany({
        where: { restauranteId: finalRestauranteId },
        include: {
          items: { orderBy: { nombre: 'asc' } },
        },
        orderBy: { orden: 'asc' },
      });
    });
  }

  async createCategoria(
    tenantId: string,
    restauranteId: string | undefined,
    keycloakId: string,
    data: { nombre: string; orden?: number },
  ) {
    const finalRestauranteId = await this.resolveRestauranteId(
      tenantId,
      restauranteId,
      keycloakId,
    );

    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const nuevaCategoria = await tx.categoriaCarta.create({
        data: {
          ...data,
          tenantId,
          restauranteId: finalRestauranteId,
          orden: data.orden ?? 0,
        },
      });

      this.logger.log(`Categoría creada: ${nuevaCategoria.id}`);
      return nuevaCategoria;
    });
  }

  async updateCategoria(
    tenantId: string,
    categoriaId: string,
    dto: UpdateCategoriaDto,
  ) {
    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const existing = await tx.categoriaCarta.findFirst({
        where: { id: categoriaId, tenantId },
      });

      if (!existing) {
        throw new NotFoundException(
          'Categoría no encontrada o no pertenece a este tenant',
        );
      }

      const updated = await tx.categoriaCarta.update({
        where: { id: categoriaId },
        data: dto,
      });

      if (dto.activo !== undefined) {
        this.menuGateway.emitCategoriaUpdated(tenantId, {
          categoriaId,
          activo: dto.activo,
        });
      }

      this.logger.log(`Categoría actualizada: ${categoriaId}`);
      return updated;
    });
  }

  async createItem(
    tenantId: string,
    data: {
      categoriaId: string;
      nombre: string;
      precio: string;
      descripcion?: string;
      disponible?: boolean;
      imagenKey?: string;
    },
  ) {
    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const categoria = await tx.categoriaCarta.findFirst({
        where: { id: data.categoriaId, tenantId },
      });

      if (!categoria) {
        throw new NotFoundException(
          'La categoría especificada no existe o no pertenece a este tenant',
        );
      }

      const nuevoItem = await tx.itemCarta.create({
        data: {
          ...data,
          tenantId,
          disponible: data.disponible ?? true,
        },
      });

      this.logger.log(`Ítem creado: ${nuevoItem.id}`);
      return nuevoItem;
    });
  }

  async updateItem(tenantId: string, itemId: string, dto: UpdateItemDto) {
    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const existing = await tx.itemCarta.findFirst({
        where: { id: itemId, tenantId },
      });

      if (!existing) {
        throw new NotFoundException(
          'Ítem no encontrado o no pertenece a este tenant',
        );
      }

      if (dto.categoriaId && dto.categoriaId !== existing.categoriaId) {
        const nuevaCategoria = await tx.categoriaCarta.findFirst({
          where: { id: dto.categoriaId, tenantId },
        });
        if (!nuevaCategoria) {
          throw new NotFoundException(
            'La nueva categoría no existe o no pertenece a este tenant',
          );
        }
      }

      const updated = await tx.itemCarta.update({
        where: { id: itemId },
        data: dto,
      });

      if (dto.disponible !== undefined) {
        this.menuGateway.emitItemUpdated(tenantId, {
          itemId,
          disponible: dto.disponible,
        });
      }

      this.logger.log(`Ítem actualizado: ${itemId}`);
      return updated;
    });
  }
}
