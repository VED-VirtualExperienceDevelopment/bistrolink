import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { MenuGateway } from './menu.gateway';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { StorageService } from './storage.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * HU-035 (BL-205): de precio y disponibilidad, solo lo que cambió (el precio
 * se compara como decimal: 590 y 590.00 son el mismo).
 */
/** Precio tal como llega: decimal de Prisma, texto del DTO o vacío. */
type PrecioCarta = Prisma.Decimal | string | null;

export function camposCambiados(
  antes: { precio?: PrecioCarta; disponible?: boolean },
  despues: { precio?: PrecioCarta; disponible?: boolean },
): { antes: Record<string, unknown>; despues: Record<string, unknown> } {
  const a: Record<string, unknown> = {};
  const d: Record<string, unknown> = {};
  if (
    antes.precio != null &&
    despues.precio != null &&
    !new Prisma.Decimal(antes.precio).equals(despues.precio)
  ) {
    a.precio = new Prisma.Decimal(antes.precio).toFixed(2);
    d.precio = new Prisma.Decimal(despues.precio).toFixed(2);
  }
  if (
    antes.disponible !== undefined &&
    despues.disponible !== undefined &&
    antes.disponible !== despues.disponible
  ) {
    a.disponible = antes.disponible;
    d.disponible = despues.disponible;
  }
  return { antes: a, despues: d };
}

const MENSAJE_IMAGEN_AJENA =
  'La imagen indicada no pertenece a este restaurante';
export const MENSAJE_CATEGORIA_REPETIDA =
  'Ya existe una categoría con ese nombre';
export const MENSAJE_ITEM_REPETIDO =
  'Ya existe un ítem con ese nombre en esta categoría';

/**
 * BL-393 y BL-395: los nombres de ítems y categorías no archivados son únicos
 * (índices parciales de la migración, sin distinguir mayúsculas). Si se
 * repite uno, la base responde P2002 y la API devuelve 409 en lugar de 500.
 */
async function conNombreUnico<T>(
  operacion: Promise<T>,
  mensaje: string,
): Promise<T> {
  try {
    return await operacion;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictException(mensaje);
    }
    throw err;
  }
}
const MENSAJE_IMAGEN_INEXISTENTE =
  'La imagen indicada no existe. Volvé a subirla.';

@Injectable()
export class MenuAdminService {
  private readonly logger = new Logger(MenuAdminService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly menuGateway: MenuGateway,
    private readonly storage: StorageService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * BL-54 y BL-387: la imagen tiene que ser una imagen PUBLICADA de este
   * tenant ({tenant}/menu/{uuid}.webp, generada por la confirmación) y
   * tiene que existir en el bucket. Si no, 400 sin guardar nada.
   */
  private async validarImagen(key: string, tenantId: string): Promise<void> {
    if (!this.storage.esKeyDelTenant(key, tenantId)) {
      throw new BadRequestException(MENSAJE_IMAGEN_AJENA);
    }
    if (!(await this.storage.existeImagen(key))) {
      throw new BadRequestException(MENSAJE_IMAGEN_INEXISTENTE);
    }
  }

  /** BL-387: deja en la auditoría el alta, cambio o quita de una imagen. */
  private auditarCambioDeImagen(
    tx: PrismaClient,
    tenantId: string,
    actorKeycloakId: string | undefined,
    itemId: string,
    keyAnterior: string | null,
    keyNueva: string | null,
  ): Promise<void> {
    return this.auditLog.registrarEnTx(tx, {
      action: AuditAction.CARTA_ITEM_IMAGEN_CAMBIADA,
      tenantId,
      actorKeycloakId: actorKeycloakId ?? 'desconocido',
      entidadId: itemId,
      detalle: {
        itemId,
        imagenKeyAnterior: keyAnterior,
        imagenKeyNueva: keyNueva,
      },
    });
  }

  /**
   * HU-035 (BL-205): cambios de precio y de disponibilidad (stock) de un
   * ítem, con los valores antes y después. Va en la transacción del cambio.
   */
  private async auditarPrecioYDisponibilidad(
    tx: PrismaClient,
    tenantId: string,
    actorKeycloakId: string | undefined,
    antes: {
      id: string;
      nombre: string;
      precio?: PrecioCarta;
      disponible?: boolean;
    },
    despues: { precio?: PrecioCarta; disponible?: boolean },
    accion: AuditAction = AuditAction.CARTA_ITEM_MODIFICADO,
  ): Promise<void> {
    const cambios = camposCambiados(antes, despues);
    if (Object.keys(cambios.antes).length === 0) return;
    await this.auditLog.registrarEnTx(tx, {
      action: accion,
      tenantId,
      actorKeycloakId: actorKeycloakId ?? 'desconocido',
      entidadId: antes.id,
      antes: cambios.antes,
      despues: cambios.despues,
      detalle: { nombre: antes.nombre },
    });
  }

  private async resolveRestauranteId(
    tenantId: string,
    restauranteId: string | undefined,
    keycloakId: string,
  ): Promise<string> {
    if (restauranteId) return restauranteId;

    const result = await this.prisma.runInTenantContext(
      tenantId,
      async (tx) => {
        return await tx.usuario.findFirst({
          where: { keycloakId },
          select: { restauranteId: true },
        });
      },
    );

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

    const categorias = await this.prisma.runInTenantContext(
      tenantId,
      async (tx) => {
        return await tx.categoriaCarta.findMany({
          where: { restauranteId: finalRestauranteId },
          include: {
            items: { orderBy: { nombre: 'asc' } },
          },
          orderBy: { orden: 'asc' },
        });
      },
    );

    // Las imágenes se sirven con URL firmada (bucket privado, TTL de HU-001),
    // igual que en el menú público. Se firma fuera de la transacción para no
    // mantenerla abierta. Si la firma falla, urlFirmadaDeLectura devuelve null
    // y el frontend muestra el placeholder.
    return Promise.all(
      categorias.map(async (cat) => ({
        ...cat,
        items: await Promise.all(
          cat.items.map(async (item) => ({
            ...item,
            imagenUrl: item.imagenKey
              ? await this.storage.urlFirmadaDeLectura(item.imagenKey)
              : null,
          })),
        ),
      })),
    );
  }

  async createCategoria(
    tenantId: string,
    restauranteId: string | undefined,
    keycloakId: string,
    data: CreateCategoriaDto,
  ) {
    const finalRestauranteId = await this.resolveRestauranteId(
      tenantId,
      restauranteId,
      keycloakId,
    );

    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const nuevaCategoria = await conNombreUnico(
        tx.categoriaCarta.create({
          data: {
            ...data,
            tenantId,
            restauranteId: finalRestauranteId,
            orden: data.orden ?? 0,
          },
        }),
        MENSAJE_CATEGORIA_REPETIDA,
      );
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

      const updated = await conNombreUnico(
        tx.categoriaCarta.update({
          where: { id: categoriaId },
          data: dto,
        }),
        MENSAJE_CATEGORIA_REPETIDA,
      );

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

  async deleteCategoria(tenantId: string, categoriaId: string) {
    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const existing = await tx.categoriaCarta.findFirst({
        where: { id: categoriaId, tenantId },
      });
      if (!existing) {
        throw new NotFoundException(
          'Categoría no encontrada o no pertenece a este tenant',
        );
      }

      // Soft Delete: Desactivamos la categoría en lugar de borrarla físicamente
      const updated = await tx.categoriaCarta.update({
        where: { id: categoriaId },
        data: { activo: false },
      });

      // Emitir evento para que el frontend actualice la UI en tiempo real
      this.menuGateway.emitCategoriaUpdated(tenantId, {
        categoriaId,
        activo: false,
      });

      this.logger.log(`Categoría eliminada (soft delete): ${categoriaId}`);
      return updated;
    });
  }

  async createItem(
    tenantId: string,
    data: CreateItemDto,
    actorKeycloakId?: string,
  ) {
    // BL-387: la imagen se valida antes de abrir la transacción (consulta a
    // S3); así la transacción no queda abierta esperando la red.
    if (data.imagenKey) {
      await this.validarImagen(data.imagenKey, tenantId);
    }

    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const categoria = await tx.categoriaCarta.findFirst({
        where: { id: data.categoriaId, tenantId },
      });
      if (!categoria) {
        throw new NotFoundException(
          'La categoría especificada no existe o no pertenece a este tenant',
        );
      }

      const nuevoItem = await conNombreUnico(
        tx.itemCarta.create({
          data: {
            ...data,
            tenantId,
            disponible: data.disponible ?? true,
          },
        }),
        MENSAJE_ITEM_REPETIDO,
      );

      this.menuGateway.emitItemDataUpdated(tenantId, {
        itemId: nuevoItem.id,
        data: nuevoItem as unknown as Record<string, unknown>,
      });

      if (nuevoItem.imagenKey) {
        await this.auditarCambioDeImagen(
          tx,
          tenantId,
          actorKeycloakId,
          nuevoItem.id,
          null,
          nuevoItem.imagenKey,
        );
      }

      this.logger.log(`Ítem creado: ${nuevoItem.id}`);
      return nuevoItem;
    });
  }

  async updateItem(
    tenantId: string,
    itemId: string,
    dto: UpdateItemDto,
    actorKeycloakId?: string,
  ) {
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

      // BL-54 y BL-387: mismo control que en createItem, solo si la imagen
      // CAMBIA. Si el formulario reenvía la misma key, no se vuelve a validar:
      // las imágenes anteriores al reprocesamiento (BL-390) siguen sirviendo
      // hasta que se reemplacen.
      const cambiaLaImagen =
        dto.imagenKey !== undefined && dto.imagenKey !== existing.imagenKey;
      if (cambiaLaImagen && dto.imagenKey) {
        await this.validarImagen(dto.imagenKey, tenantId);
      }

      const updated = await conNombreUnico(
        tx.itemCarta.update({
          where: { id: itemId },
          data: dto,
        }),
        MENSAJE_ITEM_REPETIDO,
      );

      this.menuGateway.emitItemDataUpdated(tenantId, {
        itemId,
        data: updated as unknown as Record<string, unknown>,
      });

      await this.auditarPrecioYDisponibilidad(
        tx,
        tenantId,
        actorKeycloakId,
        existing,
        updated,
      );

      if (cambiaLaImagen) {
        await this.auditarCambioDeImagen(
          tx,
          tenantId,
          actorKeycloakId,
          itemId,
          existing.imagenKey,
          updated.imagenKey,
        );
      }

      this.logger.log(`Ítem actualizado: ${itemId}`);
      return updated;
    });
  }

  /**
   * BL-395: marcar un ítem como agotado o disponible (ADMIN y MOZO). Avisa a
   * las otras pantallas de Gestión de Carta abiertas con el mismo evento que
   * la baja, y queda en la auditoría como cambio de disponibilidad (HU-035).
   */
  async cambiarDisponibilidad(
    tenantId: string,
    itemId: string,
    disponible: boolean,
    actorKeycloakId?: string,
  ) {
    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const existing = await tx.itemCarta.findFirst({
        where: { id: itemId, tenantId },
      });
      if (!existing) {
        throw new NotFoundException(
          'Ítem no encontrado o no pertenece a este tenant',
        );
      }

      const updated = await tx.itemCarta.update({
        where: { id: itemId },
        data: { disponible },
      });

      this.menuGateway.emitItemUpdated(tenantId, { itemId, disponible });

      await this.auditarPrecioYDisponibilidad(
        tx,
        tenantId,
        actorKeycloakId,
        existing,
        updated,
      );

      this.logger.log(
        `Ítem ${disponible ? 'disponible' : 'agotado'}: ${itemId}`,
      );
      return updated;
    });
  }

  async deleteItem(tenantId: string, itemId: string, actorKeycloakId?: string) {
    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const existing = await tx.itemCarta.findFirst({
        where: { id: itemId, tenantId },
      });
      if (!existing) {
        throw new NotFoundException(
          'Ítem no encontrado o no pertenece a este tenant',
        );
      }

      // Soft Delete: Marcamos como no disponible en lugar de borrar físicamente
      const updated = await tx.itemCarta.update({
        where: { id: itemId },
        data: { disponible: false },
      });

      // HU-035 (BL-205): la baja de un ítem es un cambio de disponibilidad.
      await this.auditarPrecioYDisponibilidad(
        tx,
        tenantId,
        actorKeycloakId,
        existing,
        updated,
        AuditAction.CARTA_ITEM_DADO_DE_BAJA,
      );

      // Emitir evento para que el menú público lo quite inmediatamente
      this.menuGateway.emitItemUpdated(tenantId, {
        itemId,
        disponible: false,
      });

      this.logger.log(`Ítem eliminado (soft delete): ${itemId}`);
      return updated;
    });
  }
}
