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

const SOLO_PLATAFORMA: CampoEstablecimiento[] = ['rut', 'plan'];
const DEL_RESTAURANTE: CampoEstablecimiento[] = [
  'restauranteNombre',
  'restauranteDireccion',
];

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
      pedidos.some((campo) => SOLO_PLATAFORMA.includes(campo))
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

  private async aplicarCambios(
    tx: PrismaClient,
    tenantId: string,
    dto: EditarEstablecimientoDto,
    pedidos: CampoEstablecimiento[],
  ): Promise<CampoEstablecimiento[]> {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { razonSocial: true, rut: true, plan: true },
    });
    if (!tenant) {
      throw new NotFoundException('No existe un establecimiento con ese id');
    }

    const tocaRestaurante = pedidos.some((c) => DEL_RESTAURANTE.includes(c));
    const restaurante = tocaRestaurante
      ? await tx.restaurante.findUnique({
          where: { tenantId },
          select: { nombre: true, direccion: true },
        })
      : null;
    if (tocaRestaurante && !restaurante) {
      throw new ConflictException(
        'El establecimiento todavía no tiene restaurante: completá el alta antes de editar su nombre o dirección',
      );
    }

    const campos: CampoEstablecimiento[] = [];
    const datosTenant: Prisma.TenantUpdateInput = {};
    const datosRestaurante: Prisma.RestauranteUpdateInput = {};

    if (
      dto.razonSocial !== undefined &&
      dto.razonSocial !== tenant.razonSocial
    ) {
      datosTenant.razonSocial = dto.razonSocial;
      campos.push('razonSocial');
    }
    if (dto.rut !== undefined && dto.rut !== tenant.rut) {
      const otro = await tx.tenant.findUnique({
        where: { rut: dto.rut },
        select: { id: true },
      });
      if (otro && otro.id !== tenantId) {
        throw new ConflictException(
          'El RUT ya pertenece a otro establecimiento',
        );
      }
      datosTenant.rut = dto.rut;
      campos.push('rut');
    }
    if (dto.plan !== undefined && dto.plan !== tenant.plan) {
      datosTenant.plan = dto.plan;
      campos.push('plan');
    }
    if (
      dto.restauranteNombre !== undefined &&
      dto.restauranteNombre !== restaurante?.nombre
    ) {
      datosRestaurante.nombre = dto.restauranteNombre;
      campos.push('restauranteNombre');
    }
    if (
      dto.restauranteDireccion !== undefined &&
      dto.restauranteDireccion !== restaurante?.direccion
    ) {
      datosRestaurante.direccion = dto.restauranteDireccion;
      campos.push('restauranteDireccion');
    }

    if (Object.keys(datosTenant).length > 0) {
      await tx.tenant.update({ where: { id: tenantId }, data: datosTenant });
    }
    if (Object.keys(datosRestaurante).length > 0) {
      await tx.restaurante.update({
        where: { tenantId },
        data: datosRestaurante,
      });
    }
    return campos;
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
