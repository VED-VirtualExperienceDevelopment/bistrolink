import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { KeycloakAdminService } from '../keycloak-admin/keycloak-admin.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import { TenantEstadoService } from '../tenant-estado/tenant-estado.service';
import { ESTADOS_PEDIDO_ABIERTO } from './ficha-establecimiento.service';

/**
 * BL-413: sesiones de Keycloak cerradas al suspender. `sinCerrar` cuenta
 * las que Keycloak no pudo cerrar; null si ni siquiera se pudo listar los
 * usuarios del tenant.
 */
export interface SesionesCerradas {
  cerradas: number;
  sinCerrar: number | null;
}

const MENSAJE_NO_EXISTE = 'No existe un establecimiento con ese id';

/**
 * BL-413: suspender y reactivar un establecimiento (rol PLATAFORMA).
 *
 * Suspender:
 * - Pasa el tenant a SUSPENDIDO con la fecha y el motivo. El UPDATE solo
 *   toma un tenant ACTIVO, así dos suspensiones a la vez no se pisan.
 * - No borra ni cambia ningún otro dato. Los pedidos abiertos quedan como
 *   están (se cuentan para la auditoría); los usuarios no se desactivan,
 *   así reactivar no tiene que recordar quién estaba desactivado antes.
 * - Invalida la caché de TenantEstadoService: desde el próximo request,
 *   todo token del tenant recibe 403 (estrategia JWT, WebSocket, token del
 *   comensal y menú público).
 * - Cierra las sesiones de Keycloak de todos los usuarios del tenant
 *   (también Cocina y el comensal técnico), para que no puedan renovar el
 *   token. Si Keycloak falla, la suspensión ya quedó hecha y el 403 la
 *   cubre igual: se registra cuántas no se pudieron cerrar.
 *
 * Reactivar: vuelve a ACTIVO y limpia la fecha y el motivo (el CHECK de la
 * migración de BL-410 lo exige). Los usuarios vuelven a entrar con su
 * contraseña de siempre.
 */
@Injectable()
export class SuspensionEstablecimientoService {
  private readonly logger = new Logger(SuspensionEstablecimientoService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly keycloakAdmin: KeycloakAdminService,
    private readonly tenantEstado: TenantEstadoService,
    private readonly auditLog: AuditLogService,
  ) {}

  async suspender(
    tenantId: string,
    motivo: string,
    actor: { id: string },
    ahora: Date = new Date(),
  ): Promise<void> {
    const pedidosAbiertos = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const { count } = await tx.tenant.updateMany({
          where: { id: tenantId, estado: 'ACTIVO' },
          data: {
            estado: 'SUSPENDIDO',
            suspendidoEn: ahora,
            motivoSuspension: motivo,
          },
        });
        if (count === 0) {
          await this.rechazarSinCambio(
            tx,
            tenantId,
            'El establecimiento ya está suspendido',
          );
        }
        return tx.pedido.count({
          where: { tenantId, estado: { in: ESTADOS_PEDIDO_ABIERTO } },
        });
      },
    );

    this.tenantEstado.invalidar(tenantId);
    const sesiones = await this.cerrarSesiones(tenantId);

    this.auditLog.registrar({
      action: AuditAction.ESTABLECIMIENTO_SUSPENDIDO,
      tenantId,
      actorKeycloakId: actor.id,
      targetUsuarioId: tenantId,
      detalle: { motivo, pedidosAbiertos, sesiones },
    });
  }

  async reactivar(tenantId: string, actor: { id: string }): Promise<void> {
    await this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const { count } = await tx.tenant.updateMany({
        where: { id: tenantId, estado: 'SUSPENDIDO' },
        data: { estado: 'ACTIVO', suspendidoEn: null, motivoSuspension: null },
      });
      if (count === 0) {
        await this.rechazarSinCambio(
          tx,
          tenantId,
          'El establecimiento no está suspendido',
        );
      }
    });

    this.tenantEstado.invalidar(tenantId);

    this.auditLog.registrar({
      action: AuditAction.ESTABLECIMIENTO_REACTIVADO,
      tenantId,
      actorKeycloakId: actor.id,
      targetUsuarioId: tenantId,
    });
  }

  /** El UPDATE no tomó ninguna fila: 404 si no existe, 409 si ya estaba así. */
  private async rechazarSinCambio(
    tx: PrismaClient,
    tenantId: string,
    mensajeConflicto: string,
  ): Promise<never> {
    const existe = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!existe) {
      throw new NotFoundException(MENSAJE_NO_EXISTE);
    }
    throw new ConflictException(mensajeConflicto);
  }

  /**
   * Cierra las sesiones de cada usuario del tenant. Se vuelve a comparar el
   * tenant_id de cada uno: la búsqueda por atributo es de Keycloak y la
   * verificación queda en nuestro código (mismo criterio que UsuariosService).
   */
  private async cerrarSesiones(tenantId: string): Promise<SesionesCerradas> {
    let ids: string[];
    try {
      const usuarios =
        await this.keycloakAdmin.listarUsuariosDelTenant(tenantId);
      ids = usuarios
        .filter((u) => u.attributes?.tenant_id?.includes(tenantId))
        .map((u) => u.id);
    } catch (error) {
      this.logger.warn(
        `Establecimiento ${tenantId} suspendido, pero no se pudieron listar sus usuarios en Keycloak para cerrar las sesiones: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { cerradas: 0, sinCerrar: null };
    }

    // logoutUser no lanza: devuelve si pudo cerrarlas.
    const resultados = await Promise.all(
      ids.map((id) => this.keycloakAdmin.logoutUser(id)),
    );
    const cerradas = resultados.filter(Boolean).length;
    return { cerradas, sinCerrar: resultados.length - cerradas };
  }
}
