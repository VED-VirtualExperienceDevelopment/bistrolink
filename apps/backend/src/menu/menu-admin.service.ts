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

/**
 * BL-396: cambios de una categoría que quedan en la auditoría (nombre,
 * descripción y visibilidad), solo los que cambiaron. `activo` se registra
 * como `visible`, que es lo que ve el administrador.
 */
export function cambiosDeCategoria(
  antes: { nombre: string; descripcion?: string | null; activo: boolean },
  despues: { nombre: string; descripcion?: string | null; activo: boolean },
): { antes: Record<string, unknown>; despues: Record<string, unknown> } {
  const a: Record<string, unknown> = {};
  const d: Record<string, unknown> = {};
  if (antes.nombre !== despues.nombre) {
    a.nombre = antes.nombre;
    d.nombre = despues.nombre;
  }
  if ((antes.descripcion ?? null) !== (despues.descripcion ?? null)) {
    a.descripcion = antes.descripcion ?? null;
    d.descripcion = despues.descripcion ?? null;
  }
  if (antes.activo !== despues.activo) {
    a.visible = antes.activo;
    d.visible = despues.activo;
  }
  return { antes: a, despues: d };
}

const MENSAJE_IMAGEN_AJENA =
  'La imagen indicada no pertenece a este restaurante';
export const MENSAJE_CATEGORIA_REPETIDA =
  'Ya existe una categoría con ese nombre';
export const MENSAJE_ITEM_REPETIDO =
  'Ya existe un ítem con ese nombre en esta categoría';

// BL-394: reglas de archivo y eliminación (sección 3 de la propuesta).
export const MENSAJE_ITEM_CON_HISTORIAL =
  'El ítem tiene pedidos y no se puede eliminar. Archivalo para sacarlo de la carta.';
export const MENSAJE_CATEGORIA_CON_ITEMS =
  'La categoría tiene ítems y no se puede eliminar. Eliminalos o movelos a otra categoría primero.';
export const MENSAJE_CATEGORIA_CON_ITEMS_ACTIVOS =
  'La categoría tiene ítems activos. Archivalos o movelos a otra categoría antes de archivarla.';
export const MENSAJE_ITEM_ARCHIVADO =
  'El ítem está archivado. Restauralo para modificarlo.';
export const MENSAJE_CATEGORIA_ARCHIVADA =
  'La categoría está archivada. Restaurala primero.';
// BL-394: bloqueo optimista (propuesta v0.9, §3.3).
export const MENSAJE_EDICION_CONCURRENTE =
  'Otra persona modificó este dato. Recargá para ver los cambios.';

function esErrorPrisma(err: unknown, codigo: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === codigo
  );
}

/**
 * Traduce los errores esperables de la base a respuestas claras:
 * - P2002 (BL-393 y BL-395): nombre repetido entre los no archivados
 *   (índices únicos parciales de la migración) → 409 con `mensajeNombre`.
 * - P2025 (BL-394): la fila cambió de versión entre la lectura y la
 *   escritura (bloqueo optimista) → 409 «Otra persona modificó…».
 */
async function guardarCarta<T>(
  operacion: Promise<T>,
  mensajeNombre: string,
): Promise<T> {
  try {
    return await operacion;
  } catch (err) {
    if (esErrorPrisma(err, 'P2002')) {
      throw new ConflictException(mensajeNombre);
    }
    if (esErrorPrisma(err, 'P2025')) {
      throw new ConflictException(MENSAJE_EDICION_CONCURRENTE);
    }
    throw err;
  }
}

/**
 * BL-394: versión que mandó el formulario (`updatedAt`). Si no coincide con
 * la de la base, otra persona guardó antes: 409 sin pisar sus cambios. Si el
 * formulario no la manda, se guarda como antes (la vista la empieza a mandar
 * en BL-398).
 */
function verificarVersion(
  actual: { updatedAt?: Date | null },
  version: string | undefined,
): { updatedAt: Date } | Record<string, never> {
  if (!version) return {};
  const esperada = new Date(version);
  if (actual.updatedAt && actual.updatedAt.getTime() !== esperada.getTime()) {
    throw new ConflictException(MENSAJE_EDICION_CONCURRENTE);
  }
  // También va en el WHERE del update: si otra transacción guardó entre la
  // lectura y la escritura, Prisma responde P2025 y guardarCarta da 409.
  return { updatedAt: esperada };
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

  /**
   * BL-396: registro de una acción de la carta (alta, archivo, restauración,
   * eliminación) en la misma transacción. El objeto se identifica por su id y
   * su nombre; no lleva datos personales.
   */
  private auditarCarta(
    tx: PrismaClient,
    tenantId: string,
    actorKeycloakId: string | undefined,
    accion: AuditAction,
    entidadId: string,
    nombre: string,
    cambios?: {
      antes?: Record<string, unknown>;
      despues?: Record<string, unknown>;
    },
  ): Promise<void> {
    return this.auditLog.registrarEnTx(tx, {
      action: accion,
      tenantId,
      actorKeycloakId: actorKeycloakId ?? 'desconocido',
      entidadId,
      detalle: { nombre },
      ...cambios,
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
    incluirArchivados = false,
  ) {
    const finalRestauranteId = await this.resolveRestauranteId(
      tenantId,
      restauranteId,
      keycloakId,
    );

    const categorias = await this.prisma.runInTenantContext(
      tenantId,
      async (tx) => {
        // BL-394: por defecto no se listan los archivados (se ven con el
        // filtro «Archivados» de la vista). _count.lineasPedido dice si el
        // ítem tiene historial, para ofrecer «Eliminar» solo cuando se puede.
        return await tx.categoriaCarta.findMany({
          where: incluirArchivados
            ? { restauranteId: finalRestauranteId }
            : { restauranteId: finalRestauranteId, archivadaEn: null },
          include: {
            items: {
              ...(incluirArchivados ? {} : { where: { archivadoEn: null } }),
              // BL-397: mismo orden que ve el comensal.
              orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
              include: { _count: { select: { lineasPedido: true } } },
            },
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
          cat.items.map(async ({ _count, ...item }) => ({
            ...item,
            tieneHistorial: (_count?.lineasPedido ?? 0) > 0,
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
      const nuevaCategoria = await guardarCarta(
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
      await this.auditarCarta(
        tx,
        tenantId,
        keycloakId,
        AuditAction.CARTA_CATEGORIA_CREADA,
        nuevaCategoria.id,
        nuevaCategoria.nombre,
      );
      this.logger.log(`Categoría creada: ${nuevaCategoria.id}`);
      return nuevaCategoria;
    });
  }

  async updateCategoria(
    tenantId: string,
    categoriaId: string,
    dto: UpdateCategoriaDto,
    actorKeycloakId?: string,
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
      if (existing.archivadaEn) {
        throw new ConflictException(MENSAJE_CATEGORIA_ARCHIVADA);
      }

      const { updatedAt: version, ...cambios } = dto;
      const updated = await guardarCarta(
        tx.categoriaCarta.update({
          where: { id: categoriaId, ...verificarVersion(existing, version) },
          data: cambios,
        }),
        MENSAJE_CATEGORIA_REPETIDA,
      );

      if (dto.activo !== undefined) {
        this.menuGateway.emitCategoriaUpdated(tenantId, {
          categoriaId,
          activo: dto.activo,
        });
      }

      // BL-396: nombre, descripción u ocultar/mostrar, con antes y después.
      // Cambiar solo el orden no se audita.
      const cambiosAuditados = cambiosDeCategoria(existing, updated);
      if (Object.keys(cambiosAuditados.antes).length > 0) {
        await this.auditarCarta(
          tx,
          tenantId,
          actorKeycloakId,
          AuditAction.CARTA_CATEGORIA_MODIFICADA,
          categoriaId,
          updated.nombre,
          cambiosAuditados,
        );
      }

      this.logger.log(`Categoría actualizada: ${categoriaId}`);
      return updated;
    });
  }

  /** Categoría del tenant o 404. */
  private async categoriaDelTenant(
    tx: PrismaClient,
    tenantId: string,
    categoriaId: string,
  ) {
    const categoria = await tx.categoriaCarta.findFirst({
      where: { id: categoriaId, tenantId },
    });
    if (!categoria) {
      throw new NotFoundException(
        'Categoría no encontrada o no pertenece a este tenant',
      );
    }
    return categoria;
  }

  /**
   * BL-394: archivar una categoría (baja lógica). Solo si no le quedan ítems
   * activos: primero se archivan o se mueven. Si ya estaba archivada, no
   * hace nada.
   */
  async archivarCategoria(
    tenantId: string,
    categoriaId: string,
    actorKeycloakId?: string,
  ) {
    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const existing = await this.categoriaDelTenant(tx, tenantId, categoriaId);
      if (existing.archivadaEn) return existing;

      const activos = await tx.itemCarta.count({
        where: { categoriaId, archivadoEn: null },
      });
      if (activos > 0) {
        throw new ConflictException(MENSAJE_CATEGORIA_CON_ITEMS_ACTIVOS);
      }

      const updated = await tx.categoriaCarta.update({
        where: { id: categoriaId },
        data: { archivadaEn: new Date() },
      });
      await this.auditarCarta(
        tx,
        tenantId,
        actorKeycloakId,
        AuditAction.CARTA_CATEGORIA_ARCHIVADA,
        categoriaId,
        existing.nombre,
      );
      this.menuGateway.emitCategoriaRetirada(tenantId, { categoriaId });
      this.logger.log(`Categoría archivada: ${categoriaId}`);
      return updated;
    });
  }

  /**
   * BL-394: restaurar una categoría archivada. Si mientras tanto se creó
   * otra con el mismo nombre, 409 (hay que renombrar una de las dos).
   */
  async restaurarCategoria(
    tenantId: string,
    categoriaId: string,
    actorKeycloakId?: string,
  ) {
    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const existing = await this.categoriaDelTenant(tx, tenantId, categoriaId);
      if (!existing.archivadaEn) return existing;

      const updated = await guardarCarta(
        tx.categoriaCarta.update({
          where: { id: categoriaId },
          data: { archivadaEn: null },
        }),
        MENSAJE_CATEGORIA_REPETIDA,
      );
      await this.auditarCarta(
        tx,
        tenantId,
        actorKeycloakId,
        AuditAction.CARTA_CATEGORIA_RESTAURADA,
        categoriaId,
        existing.nombre,
      );
      this.menuGateway.emitCategoriaUpdated(tenantId, {
        categoriaId,
        activo: updated.activo,
      });
      this.logger.log(`Categoría restaurada: ${categoriaId}`);
      return updated;
    });
  }

  /**
   * BL-394: eliminar definitivamente una categoría. Solo si no tiene ningún
   * ítem, ni siquiera archivado (si no, 409). La FK de item_carta también lo
   * impide si se cruza con un alta: se traduce al mismo 409.
   */
  async eliminarCategoria(
    tenantId: string,
    categoriaId: string,
    actorKeycloakId?: string,
  ) {
    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const existing = await this.categoriaDelTenant(tx, tenantId, categoriaId);

      const items = await tx.itemCarta.count({ where: { categoriaId } });
      if (items > 0) {
        throw new ConflictException(MENSAJE_CATEGORIA_CON_ITEMS);
      }

      try {
        await tx.categoriaCarta.delete({ where: { id: categoriaId } });
      } catch (err) {
        if (esErrorPrisma(err, 'P2003')) {
          throw new ConflictException(MENSAJE_CATEGORIA_CON_ITEMS);
        }
        throw err;
      }
      // El registro queda aunque la categoría ya no exista.
      await this.auditarCarta(
        tx,
        tenantId,
        actorKeycloakId,
        AuditAction.CARTA_CATEGORIA_ELIMINADA,
        categoriaId,
        existing.nombre,
      );
      this.menuGateway.emitCategoriaRetirada(tenantId, { categoriaId });
      this.logger.log(`Categoría eliminada: ${categoriaId}`);
      return { id: categoriaId, eliminada: true };
    });
  }

  /** BL-394: los ítems nuevos o movidos van al final de su categoría. */
  private async siguienteOrden(
    tx: PrismaClient,
    categoriaId: string,
  ): Promise<number> {
    const { _max } = await tx.itemCarta.aggregate({
      where: { categoriaId },
      _max: { orden: true },
    });
    return (_max.orden ?? 0) + 1;
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
      if (categoria.archivadaEn) {
        throw new ConflictException(MENSAJE_CATEGORIA_ARCHIVADA);
      }

      const nuevoItem = await guardarCarta(
        tx.itemCarta.create({
          data: {
            ...data,
            tenantId,
            disponible: data.disponible ?? true,
            orden: await this.siguienteOrden(tx, data.categoriaId),
          },
        }),
        MENSAJE_ITEM_REPETIDO,
      );

      this.menuGateway.emitItemDataUpdated(tenantId, {
        itemId: nuevoItem.id,
        data: nuevoItem as unknown as Record<string, unknown>,
      });

      // BL-396: el alta, con el precio y la disponibilidad iniciales.
      await this.auditarCarta(
        tx,
        tenantId,
        actorKeycloakId,
        AuditAction.CARTA_ITEM_CREADO,
        nuevoItem.id,
        nuevoItem.nombre,
        {
          despues: {
            precio: nuevoItem.precio,
            disponible: nuevoItem.disponible,
          },
        },
      );

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

      if (existing.archivadoEn) {
        throw new ConflictException(MENSAJE_ITEM_ARCHIVADO);
      }
      const { updatedAt: version, ...cambios } = dto;
      const condicionVersion = verificarVersion(existing, version);

      // BL-394: al moverlo de categoría, va al final de la nueva.
      let ordenEnNuevaCategoria: { orden: number } | Record<string, never> = {};
      if (dto.categoriaId && dto.categoriaId !== existing.categoriaId) {
        const nuevaCategoria = await tx.categoriaCarta.findFirst({
          where: { id: dto.categoriaId, tenantId },
        });
        if (!nuevaCategoria) {
          throw new NotFoundException(
            'La nueva categoría no existe o no pertenece a este tenant',
          );
        }
        if (nuevaCategoria.archivadaEn) {
          throw new ConflictException(MENSAJE_CATEGORIA_ARCHIVADA);
        }
        ordenEnNuevaCategoria = {
          orden: await this.siguienteOrden(tx, dto.categoriaId),
        };
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

      const updated = await guardarCarta(
        tx.itemCarta.update({
          where: { id: itemId, ...condicionVersion },
          data: { ...cambios, ...ordenEnNuevaCategoria },
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
      if (existing.archivadoEn) {
        throw new ConflictException(MENSAJE_ITEM_ARCHIVADO);
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

  /** Ítem del tenant o 404. */
  private async itemDelTenant(
    tx: PrismaClient,
    tenantId: string,
    itemId: string,
  ) {
    const item = await tx.itemCarta.findFirst({
      where: { id: itemId, tenantId },
    });
    if (!item) {
      throw new NotFoundException(
        'Ítem no encontrado o no pertenece a este tenant',
      );
    }
    return item;
  }

  /**
   * BL-394: archivar un ítem (baja lógica, reemplaza al «Eliminar» que lo
   * marcaba como agotado). Deja de verse en la carta y en Gestión de Carta
   * (salvo con el filtro «Archivados»), pero conserva su historial. Si ya
   * estaba archivado, no hace nada. Queda en la auditoría (BL-396).
   */
  async archivarItem(
    tenantId: string,
    itemId: string,
    actorKeycloakId?: string,
  ) {
    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const existing = await this.itemDelTenant(tx, tenantId, itemId);
      if (existing.archivadoEn) return existing;

      const updated = await tx.itemCarta.update({
        where: { id: itemId },
        data: { archivadoEn: new Date() },
      });
      await this.auditarCarta(
        tx,
        tenantId,
        actorKeycloakId,
        AuditAction.CARTA_ITEM_ARCHIVADO,
        itemId,
        existing.nombre,
      );
      this.menuGateway.emitItemRetirado(tenantId, { itemId });
      this.logger.log(`Ítem archivado: ${itemId}`);
      return updated;
    });
  }

  /**
   * BL-394: restaurar un ítem archivado. Su categoría tiene que estar activa
   * y su nombre libre entre los ítems activos de la categoría (si no, 409).
   */
  async restaurarItem(
    tenantId: string,
    itemId: string,
    actorKeycloakId?: string,
  ) {
    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const existing = await this.itemDelTenant(tx, tenantId, itemId);
      if (!existing.archivadoEn) return existing;

      const categoria = await this.categoriaDelTenant(
        tx,
        tenantId,
        existing.categoriaId,
      );
      if (categoria.archivadaEn) {
        throw new ConflictException(MENSAJE_CATEGORIA_ARCHIVADA);
      }

      const updated = await guardarCarta(
        tx.itemCarta.update({
          where: { id: itemId },
          data: { archivadoEn: null },
        }),
        MENSAJE_ITEM_REPETIDO,
      );
      await this.auditarCarta(
        tx,
        tenantId,
        actorKeycloakId,
        AuditAction.CARTA_ITEM_RESTAURADO,
        itemId,
        existing.nombre,
      );
      this.menuGateway.emitItemDataUpdated(tenantId, {
        itemId,
        data: updated as unknown as Record<string, unknown>,
      });
      this.logger.log(`Ítem restaurado: ${itemId}`);
      return updated;
    });
  }

  /**
   * BL-394: eliminar definitivamente un ítem. Solo si no figura en ningún
   * pedido, de ningún estado (si no, 409 «archivalo»): los pedidos guardan
   * copia del nombre y el precio, pero conservan la referencia al ítem. La FK
   * de linea_pedido (RESTRICT) lo impide igual si se cruza con un pedido.
   * La imagen queda en S3 (el usuario de la app no tiene DeleteObject).
   */
  async eliminarItem(
    tenantId: string,
    itemId: string,
    actorKeycloakId?: string,
  ) {
    return this.prisma.runInTenantContext(tenantId, async (tx) => {
      const existing = await this.itemDelTenant(tx, tenantId, itemId);

      const pedidos = await tx.lineaPedido.count({
        where: { itemCartaId: itemId },
      });
      if (pedidos > 0) {
        throw new ConflictException(MENSAJE_ITEM_CON_HISTORIAL);
      }

      try {
        await tx.itemCarta.delete({ where: { id: itemId } });
      } catch (err) {
        if (esErrorPrisma(err, 'P2003')) {
          throw new ConflictException(MENSAJE_ITEM_CON_HISTORIAL);
        }
        throw err;
      }
      // El registro queda aunque el ítem ya no exista.
      await this.auditarCarta(
        tx,
        tenantId,
        actorKeycloakId,
        AuditAction.CARTA_ITEM_ELIMINADO,
        itemId,
        existing.nombre,
      );
      this.menuGateway.emitItemRetirado(tenantId, { itemId });
      this.logger.log(`Ítem eliminado: ${itemId}`);
      return { id: itemId, eliminado: true };
    });
  }
}
