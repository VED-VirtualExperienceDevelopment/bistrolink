import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { KeycloakAdminService } from '../keycloak-admin/keycloak-admin.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';

export const MENSAJE_CON_ACTIVIDAD =
  'Tiene actividad: suspendelo en lugar de eliminarlo.';
export const MENSAJE_RUT_NO_COINCIDE =
  'El RUT no coincide con el del establecimiento.';
const MENSAJE_NO_EXISTE = 'No existe un establecimiento con ese id';

/**
 * BL-418: ¿el establecimiento tiene actividad? Alcanza con mirar si hay
 * algún pedido (de cualquier estado): pagos, comprobantes fiscales, líneas
 * e historial tienen una FK obligatoria a `pedido`, así que sin pedidos no
 * puede haber ninguno de ellos.
 *
 * Se llama dentro del contexto del tenant (RLS); igual filtra por tenant_id.
 * La usan la ficha y el listado (para ofrecer o no «Eliminar») y el borrado
 * (que lo vuelve a controlar).
 */
export async function tieneActividad(
  tx: PrismaClient,
  tenantId: string,
): Promise<boolean> {
  const pedido = await tx.pedido.findFirst({
    where: { tenantId },
    select: { id: true },
  });
  return pedido !== null;
}

/**
 * BL-418: cuentas de Keycloak del establecimiento. `pendientes` son los
 * usernames que no se pudieron borrar (hay que reintentar); null si ni
 * siquiera se pudo listar las cuentas.
 */
export interface CuentasEliminadas {
  eliminadas: number;
  pendientes: string[] | null;
}

export interface ResultadoEliminacion {
  tenantId: string;
  /** false cuando el tenant ya no existía y solo se limpió Keycloak. */
  datosEliminados: boolean;
  cuentas: CuentasEliminadas;
}

/**
 * BL-418: eliminar un establecimiento dado de alta por error, sin actividad
 * (rol PLATAFORMA). Lo que tiene historial no se borra: se suspende (BL-413).
 *
 * Base, en una sola transacción dentro del contexto del tenant (RLS):
 * - Toma el mismo candado por tenant que UsuariosService, para no cruzarse
 *   con un alta de usuario en ese momento.
 * - Controla el RUT (400 si no coincide) y la actividad (409).
 * - Borra de hijos a padres (ninguna FK tiene ON DELETE CASCADE): ítems y
 *   categorías de la carta, mesas (incluida la virtual), usuarios,
 *   restaurante y, por último, el tenant.
 * - Si entra un pedido entre el control y el borrado, la FK de pedido a mesa
 *   hace fallar el DELETE (P2003): se responde 409 y no se borra nada.
 *
 * Keycloak, después del commit: borra todas las cuentas con ese tenant_id
 * (Administradores, Cocina, Mozos y comensal-<tenantId>). Si alguna falla,
 * la respuesta y la auditoría dicen cuál quedó.
 *
 * Reintento: si el tenant ya no existe pero quedaron cuentas en Keycloak,
 * el mismo DELETE las borra (idempotente). El RUT ya no se puede comparar
 * (el tenant no está); las cuentas que quedan son huérfanas. Si no quedó
 * ninguna, 404; si Keycloak no responde, 503.
 *
 * Las imágenes de la carta en S3 no se borran (la aplicación no tiene
 * DeleteObject): quedan para la limpieza de huérfanas.
 */
@Injectable()
export class EliminacionEstablecimientoService {
  private readonly logger = new Logger(EliminacionEstablecimientoService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly keycloakAdmin: KeycloakAdminService,
    private readonly auditLog: AuditLogService,
  ) {}

  async eliminar(
    tenantId: string,
    rut: string,
    actor: { id: string },
  ): Promise<ResultadoEliminacion> {
    const tenant = await this.borrarDatos(tenantId, rut);

    if (!tenant) {
      return this.reintentarCuentas(tenantId, actor);
    }

    const cuentas = await this.borrarCuentas(tenantId);
    this.auditLog.registrar({
      action: AuditAction.ESTABLECIMIENTO_ELIMINADO,
      tenantId,
      actorKeycloakId: actor.id,
      targetUsuarioId: tenantId,
      detalle: { rut: tenant.rut, cuentas },
    });
    return { tenantId, datosEliminados: true, cuentas };
  }

  /**
   * Borra los datos del tenant en una transacción. Devuelve el tenant
   * borrado, o null si no existía (para el reintento de Keycloak).
   */
  private async borrarDatos(
    tenantId: string,
    rut: string,
  ): Promise<{ rut: string } | null> {
    try {
      return await this.tenantPrisma.runInTenantContext(
        tenantId,
        async (tx) => {
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock(hashtext($1))`,
            tenantId,
          );

          const tenant = await tx.tenant.findUnique({
            where: { id: tenantId },
            select: { rut: true },
          });
          if (!tenant) return null;
          if (tenant.rut !== rut) {
            throw new BadRequestException(MENSAJE_RUT_NO_COINCIDE);
          }
          if (await tieneActividad(tx, tenantId)) {
            throw new ConflictException(MENSAJE_CON_ACTIVIDAD);
          }

          await tx.itemCarta.deleteMany({ where: { tenantId } });
          await tx.categoriaCarta.deleteMany({ where: { tenantId } });
          await tx.mesa.deleteMany({ where: { tenantId } });
          await tx.usuario.deleteMany({ where: { tenantId } });
          await tx.restaurante.deleteMany({ where: { tenantId } });
          await tx.tenant.delete({ where: { id: tenantId } });
          return tenant;
        },
      );
    } catch (err) {
      // Carrera: entró un pedido entre el control y el borrado.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new ConflictException(MENSAJE_CON_ACTIVIDAD);
      }
      throw err;
    }
  }

  /** El tenant ya no está: solo quedan por borrar sus cuentas huérfanas. */
  private async reintentarCuentas(
    tenantId: string,
    actor: { id: string },
  ): Promise<ResultadoEliminacion> {
    const cuentas = await this.borrarCuentas(tenantId);
    if (cuentas.pendientes === null) {
      // Sin Keycloak no se sabe si quedó algo: que se reintente.
      throw new ServiceUnavailableException(
        'No se pudo consultar Keycloak. Probá de nuevo en unos minutos.',
      );
    }
    if (cuentas.eliminadas === 0 && cuentas.pendientes.length === 0) {
      throw new NotFoundException(MENSAJE_NO_EXISTE);
    }
    this.auditLog.registrar({
      action: AuditAction.ESTABLECIMIENTO_ELIMINADO,
      tenantId,
      actorKeycloakId: actor.id,
      targetUsuarioId: tenantId,
      detalle: { reintento: true, cuentas },
    });
    return { tenantId, datosEliminados: false, cuentas };
  }

  /**
   * Borra las cuentas de Keycloak del tenant, una por una. Se vuelve a
   * comparar el tenant_id de cada una: la búsqueda por atributo es de
   * Keycloak y la verificación queda en nuestro código (mismo criterio que
   * la suspensión). No lanza: lo que falla queda en `pendientes`, en el
   * mismo orden en que Keycloak listó las cuentas.
   */
  private async borrarCuentas(tenantId: string): Promise<CuentasEliminadas> {
    let cuentas: { id: string; username: string }[];
    try {
      const usuarios =
        await this.keycloakAdmin.listarUsuariosDelTenant(tenantId);
      cuentas = usuarios
        .filter((u) => u.attributes?.tenant_id?.includes(tenantId))
        .map((u) => ({ id: u.id, username: u.username }));
    } catch (error) {
      this.logger.error(
        `No se pudieron listar las cuentas de Keycloak del establecimiento ${tenantId} para borrarlas: ${mensajeDe(error)}`,
      );
      return { eliminadas: 0, pendientes: null };
    }

    // En paralelo: son pocas (personal, Cocina y el comensal) y cada una
    // es independiente. allSettled: una que falla no corta las demás.
    const resultados = await Promise.allSettled(
      cuentas.map((cuenta) => this.keycloakAdmin.deleteUser(cuenta.id)),
    );
    const pendientes: string[] = [];
    resultados.forEach((resultado, i) => {
      if (resultado.status === 'rejected') {
        this.logger.error(
          `No se pudo borrar la cuenta ${cuentas[i].username} del establecimiento ${tenantId} en Keycloak: ${mensajeDe(resultado.reason)}`,
        );
        pendientes.push(cuentas[i].username);
      }
    });
    return { eliminadas: cuentas.length - pendientes.length, pendientes };
  }
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido';
}
