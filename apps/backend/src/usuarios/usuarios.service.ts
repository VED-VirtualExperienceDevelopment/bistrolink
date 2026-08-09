import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { KeycloakAdminService } from '../keycloak-admin/keycloak-admin.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly keycloakAdmin: KeycloakAdminService,
    private readonly auditLog: AuditLogService,
  ) {}

  async listar(tenantId: string) {
    return this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.usuario.findMany({
        select: {
          id: true,
          keycloakId: true,
          username: true,
          email: true,
          rol: true,
          activo: true,
          restauranteId: true,
          createdAt: true,
        },
      }),
    );
  }

  async crear(
    tenantId: string,
    actorKeycloakId: string,
    dto: CreateUsuarioDto,
  ) {
    // Verificar que el restaurante indicado pertenezca al tenant del Admin
    // que hace la request. RLS ya filtra esta query por tenant_id, así que
    // si el restaurante es de otro tenant, simplemente no aparece acá —
    // sin esto, se podría insertar un usuario apuntando a un restaurante
    // ajeno, un dato inconsistente aunque quedara aislado igual por RLS.
    const restaurante = await this.tenantPrisma.runInTenantContext(
      tenantId,
      (tx) => tx.restaurante.findUnique({ where: { id: dto.restauranteId } }),
    );
    if (!restaurante) {
      throw new ForbiddenException(
        'El restaurante indicado no pertenece a tu establecimiento',
      );
    }

    // Genera una contraseña temporal aleatoria — el usuario la cambia en su
    // primer login (Keycloak la marca como "temporary": true).
    const temporaryPassword = randomBytes(12).toString('base64url');

    const keycloakId = await this.keycloakAdmin.createUser({
      username: dto.username,
      email: dto.email,
      tenantId,
      temporaryPassword,
    });

    try {
      await this.keycloakAdmin.assignRealmRole(keycloakId, dto.rol);

      const usuario = await this.tenantPrisma.runInTenantContext(
        tenantId,
        (tx) =>
          tx.usuario.create({
            data: {
              tenantId,
              restauranteId: dto.restauranteId,
              keycloakId,
              username: dto.username,
              email: dto.email,
              rol: dto.rol,
            },
          }),
      );

      // [S] DoD HU-013: alta de cuenta auditada en Pino, nivel INFO.
      // El campo `rol` en el detalle permite filtrar específicamente las
      // altas de cuentas Administrador en Grafana Loki.
      this.auditLog.registrar({
        action: AuditAction.USUARIO_CREADO,
        tenantId,
        actorKeycloakId,
        targetUsuarioId: usuario.id,
        detalle: { rol: usuario.rol, restauranteId: usuario.restauranteId },
      });

      return { ...usuario, temporaryPassword };
    } catch (error) {
      // Compensación: la identidad en Keycloak ya existe, pero algo falló
      // después (asignar el rol, o persistir la fila en Postgres). Sin esto,
      // quedaría un usuario en Keycloak sin fila correspondiente en la base
      // — un huérfano invisible para listar()/actualizarRol()/desactivar().
      try {
        await this.keycloakAdmin.deleteUser(keycloakId);
      } catch (cleanupError) {
        // No ocultamos el error original (es el que le importa a quien hizo
        // la request), pero sí dejamos rastro de que la compensación
        // también falló — este caso sí requiere intervención manual.
        this.logger.error(
          `No se pudo revertir el usuario ${keycloakId} en Keycloak tras un fallo en crear(). Requiere limpieza manual.`,
          cleanupError instanceof Error ? cleanupError.stack : cleanupError,
        );
      }
      throw error;
    }
  }

  async actualizarRol(
    tenantId: string,
    actorKeycloakId: string,
    usuarioId: string,
    dto: UpdateUsuarioDto,
  ) {
    const { actualizado, rolAnterior } =
      await this.tenantPrisma.runInTenantContext(
        tenantId,
        async (tx) => {
          // Advisory lock por tenant: serializa las operaciones que dependen
          // del conteo de Admins activos (RF.19), para que dos requests
          // concurrentes no lean el mismo conteo antes de que la primera
          // termine de escribir su cambio.
          await this.lockTenant(tx, tenantId);

          const usuario = await this.obtenerOFallar(tx, usuarioId);

          if (usuario.rol === 'ADMIN' && dto.rol !== 'ADMIN') {
            await this.asegurarNoEsUltimoAdmin(tx, usuarioId);
          }

          await this.keycloakAdmin.assignRealmRole(usuario.keycloakId, dto.rol);

          const actualizado = await tx.usuario.update({
            where: { id: usuarioId },
            data: { rol: dto.rol },
          });

          return { actualizado, rolAnterior: usuario.rol };
        },
        { timeout: 10_000 }, // margen extra: la transacción espera a Keycloak
      );

    // [S] DoD HU-013: todo cambio de rol se audita en Pino, nivel INFO —
    // fuera de la transacción, para no loguear un cambio que terminó en
    // rollback si algo posterior a esta línea fallara.
    this.auditLog.registrar({
      action: AuditAction.USUARIO_ROL_MODIFICADO,
      tenantId,
      actorKeycloakId,
      targetUsuarioId: usuarioId,
      detalle: { rolAnterior, rolNuevo: actualizado.rol },
    });

    return actualizado;
  }

  async desactivar(
    tenantId: string,
    actorKeycloakId: string,
    usuarioId: string,
  ) {
    const resultado = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        await this.lockTenant(tx, tenantId);

        const usuario = await this.obtenerOFallar(tx, usuarioId);

        if (usuario.rol === 'ADMIN') {
          try {
            await this.asegurarNoEsUltimoAdmin(tx, usuarioId);
          } catch (error) {
            if (error instanceof ConflictException) {
              // [S] DoD HU-013: el intento rechazado también es un evento
              // de seguridad relevante (alguien intentó dejar el tenant
              // sin Administrador) — se audita igual que el caso exitoso.
              this.auditLog.registrar({
                action: AuditAction.USUARIO_DESACTIVACION_RECHAZADA,
                tenantId,
                actorKeycloakId,
                targetUsuarioId: usuarioId,
                detalle: { rol: usuario.rol, motivo: 'ultimo_admin_activo' },
              });
            }
            throw error;
          }
        }

        // Si esto falla, la transacción entera hace rollback — el lock se
        // libera y activo nunca queda en false sobre un usuario que en los
        // hechos sigue habilitado en Keycloak.
        await this.keycloakAdmin.setEnabled(usuario.keycloakId, false);

        await tx.usuario.update({
          where: { id: usuarioId },
          data: { activo: false },
        });

        return { desactivado: true, id: usuarioId, rol: usuario.rol };
      },
      { timeout: 10_000 },
    );

    this.auditLog.registrar({
      action: AuditAction.USUARIO_DESACTIVADO,
      tenantId,
      actorKeycloakId,
      targetUsuarioId: usuarioId,
      detalle: { rol: resultado.rol },
    });

    return { desactivado: resultado.desactivado, id: resultado.id };
  }

  private async obtenerOFallar(tx: PrismaClient, usuarioId: string) {
    const usuario = await tx.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return usuario;
  }

  /** RF.19: nunca puede quedar un tenant sin ningún Admin activo. */
  private async asegurarNoEsUltimoAdmin(tx: PrismaClient, usuarioId: string) {
    const totalAdmins = await tx.usuario.count({
      where: { rol: 'ADMIN', activo: true, id: { not: usuarioId } },
    });
    if (totalAdmins === 0) {
      throw new ConflictException(
        'No es posible desactivar o cambiar el rol de la última cuenta Administrador del tenant (RF.19)',
      );
    }
  }

  /**
   * Advisory lock scopeado a la transacción actual (pg lo libera solo al
   * hacer commit/rollback). Usamos hashtext(tenantId) como clave para
   * serializar, por tenant, las operaciones sensibles a RF.19 sin necesitar
   * bloquear filas específicas que quizás todavía no existen.
   */
  private async lockTenant(tx: PrismaClient, tenantId: string) {
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      tenantId,
    );
  }
}
