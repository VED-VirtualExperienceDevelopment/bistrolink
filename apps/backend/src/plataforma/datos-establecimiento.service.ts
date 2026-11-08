import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import { EditarEstablecimientoDto } from './dto/editar-establecimiento.dto';

/**
 * BL-412: quién edita. PLATAFORMA (BL-412) puede cambiar todo; ADMIN
 * (HU-020, BL-72) no puede cambiar el RUT ni el plan.
 */
export type OrigenEdicion = 'PLATAFORMA' | 'ADMIN';

/** Campos que cambiaron, con el nombre del DTO (para la auditoría). */
export type CampoEstablecimiento = keyof EditarEstablecimientoDto;

const SOLO_PLATAFORMA: ReadonlySet<CampoEstablecimiento> = new Set([
  'rut',
  'plan',
]);
const DEL_RESTAURANTE: ReadonlySet<CampoEstablecimiento> = new Set([
  'restauranteNombre',
  'restauranteDireccion',
]);

type TenantActual = { razonSocial: string; rut: string; plan: string };
type RestauranteActual = { nombre: string; direccion: string };

/** Lo que hay que escribir en una tabla y qué campos del DTO lo pidieron. */
type Cambios<T> = { datos: T; campos: CampoEstablecimiento[] };

/** Un valor del DTO cuenta como cambio si vino y es distinto del actual. */
function cambia(
  nuevo: string | undefined,
  actual: string | undefined,
): nuevo is string {
  return nuevo !== undefined && nuevo !== actual;
}

/**
 * BL-412: corrige los datos de un establecimiento. Es el mismo servicio para
 * la plataforma y, después, para el Administrador del restaurante (HU-020):
 * las validaciones son las mismas por las dos entradas.
 *
 * - Solo se escribe lo que cambia de verdad (mandar el mismo valor no
 *   cuenta), en una transacción dentro del contexto del tenant (RLS de
 *   `restaurante`).
 * - RUT de otro establecimiento: 409. Se controla antes de escribir y, por
 *   si dos ediciones se cruzan, también el índice único (P2002 → 409).
 * - Datos del restaurante en un alta sin restaurante: 409 (primero hay que
 *   completar el alta).
 * - Auditoría ESTABLECIMIENTO_DATOS_MODIFICADOS con los nombres de los
 *   campos, sin los valores (mismo criterio que BL-366).
 */
@Injectable()
export class DatosEstablecimientoService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Devuelve los campos que cambiaron (vacío si no cambió nada). */
  async actualizar(
    tenantId: string,
    dto: EditarEstablecimientoDto,
    actor: { id: string },
    origen: OrigenEdicion,
  ): Promise<CampoEstablecimiento[]> {
    const pedidos = (Object.keys(dto) as CampoEstablecimiento[]).filter(
      (campo) => dto[campo] !== undefined,
    );
    if (pedidos.length === 0) {
      throw new BadRequestException('No hay cambios');
    }
    if (
      origen === 'ADMIN' &&
      pedidos.some((campo) => SOLO_PLATAFORMA.has(campo))
    ) {
      throw new ForbiddenException(
        'El RUT y el plan solo los cambia el equipo de BistroLink',
      );
    }

    const campos = await this.tenantPrisma
      .runInTenantContext(tenantId, (tx) =>
        this.aplicarCambios(tx, tenantId, dto, pedidos),
      )
      .catch((err) => this.traducirConflicto(err));

    if (campos.length > 0) {
      this.auditLog.registrar({
        action: AuditAction.ESTABLECIMIENTO_DATOS_MODIFICADOS,
        tenantId,
        actorKeycloakId: actor.id,
        // No hay un usuario afectado: lo que cambia es el establecimiento.
        targetUsuarioId: tenantId,
        detalle: { campos, origen },
      });
    }
    return campos;
  }

  /**
   * Lee lo actual, arma los cambios de cada tabla y los escribe. Los
   * controles (404, 409) van antes de escribir nada.
   */
  private async aplicarCambios(
    tx: PrismaClient,
    tenantId: string,
    dto: EditarEstablecimientoDto,
    pedidos: CampoEstablecimiento[],
  ): Promise<CampoEstablecimiento[]> {
    const tenant = await this.leerTenant(tx, tenantId);
    const restaurante = await this.leerRestaurante(tx, tenantId, pedidos);

    const delTenant = await this.cambiosDelTenant(tx, tenantId, dto, tenant);
    const delRestaurante = this.cambiosDelRestaurante(dto, restaurante);

    if (delTenant.campos.length > 0) {
      await tx.tenant.update({
        where: { id: tenantId },
        data: delTenant.datos,
      });
    }
    if (delRestaurante.campos.length > 0) {
      await tx.restaurante.update({
        where: { tenantId },
        data: delRestaurante.datos,
      });
    }
    return [...delTenant.campos, ...delRestaurante.campos];
  }

  private async leerTenant(
    tx: PrismaClient,
    tenantId: string,
  ): Promise<TenantActual> {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { razonSocial: true, rut: true, plan: true },
    });
    if (!tenant) {
      throw new NotFoundException('No existe un establecimiento con ese id');
    }
    return tenant;
  }

  /** Solo se lee si se piden datos del restaurante; sin restaurante: 409. */
  private async leerRestaurante(
    tx: PrismaClient,
    tenantId: string,
    pedidos: CampoEstablecimiento[],
  ): Promise<RestauranteActual | null> {
    if (!pedidos.some((c) => DEL_RESTAURANTE.has(c))) {
      return null;
    }
    const restaurante = await tx.restaurante.findUnique({
      where: { tenantId },
      select: { nombre: true, direccion: true },
    });
    if (!restaurante) {
      throw new ConflictException(
        'El establecimiento todavía no tiene restaurante: completá el alta antes de editar su nombre o dirección',
      );
    }
    return restaurante;
  }

  private async cambiosDelTenant(
    tx: PrismaClient,
    tenantId: string,
    dto: EditarEstablecimientoDto,
    tenant: TenantActual,
  ): Promise<Cambios<Prisma.TenantUpdateInput>> {
    const datos: Prisma.TenantUpdateInput = {};
    const campos: CampoEstablecimiento[] = [];

    if (cambia(dto.razonSocial, tenant.razonSocial)) {
      datos.razonSocial = dto.razonSocial;
      campos.push('razonSocial');
    }
    if (cambia(dto.rut, tenant.rut)) {
      await this.validarRutLibre(tx, tenantId, dto.rut);
      datos.rut = dto.rut;
      campos.push('rut');
    }
    if (cambia(dto.plan, tenant.plan)) {
      datos.plan = dto.plan;
      campos.push('plan');
    }
    return { datos, campos };
  }

  private cambiosDelRestaurante(
    dto: EditarEstablecimientoDto,
    restaurante: RestauranteActual | null,
  ): Cambios<Prisma.RestauranteUpdateInput> {
    const datos: Prisma.RestauranteUpdateInput = {};
    const campos: CampoEstablecimiento[] = [];

    if (cambia(dto.restauranteNombre, restaurante?.nombre)) {
      datos.nombre = dto.restauranteNombre;
      campos.push('restauranteNombre');
    }
    if (cambia(dto.restauranteDireccion, restaurante?.direccion)) {
      datos.direccion = dto.restauranteDireccion;
      campos.push('restauranteDireccion');
    }
    return { datos, campos };
  }

  /** RUT de otro establecimiento: 409 antes de escribir. */
  private async validarRutLibre(
    tx: PrismaClient,
    tenantId: string,
    rut: string,
  ): Promise<void> {
    const otro = await tx.tenant.findUnique({
      where: { rut },
      select: { id: true },
    });
    if (otro && otro.id !== tenantId) {
      throw new ConflictException('El RUT ya pertenece a otro establecimiento');
    }
  }

  /** Dos ediciones con el mismo RUT a la vez: el índice único avisa (P2002). */
  private traducirConflicto(err: unknown): never {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictException('El RUT ya pertenece a otro establecimiento');
    }
    throw err;
  }
}
