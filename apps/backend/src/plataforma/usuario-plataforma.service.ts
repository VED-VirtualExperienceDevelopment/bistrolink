import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { KeycloakAdminService } from '../keycloak-admin/keycloak-admin.service';
import { ROL_PLATAFORMA } from '../auth/rol-plataforma';
import { CrearUsuarioPlataformaDto } from './dto/crear-usuario-plataforma.dto';

export interface ResultadoUsuarioPlataforma {
  keycloakId: string;
  creado: boolean;
  /** Solo en usuarios que ya existían: si se completó email, nombre o apellido. */
  perfilCompletado?: boolean;
  /** Solo si se generó (usuario nuevo sin contraseña provista). Es temporal. */
  passwordGenerada?: string;
}

/**
 * BL-163 (HU-027): alta idempotente de un usuario de plataforma (rol
 * PLATAFORMA), el que usa /plataforma/establecimientos.
 *
 * - Sin tenant_id: no pertenece a ningún establecimiento. Si ya existe un
 *   usuario con ese username y tiene tenant_id, se rechaza: es una cuenta
 *   de un establecimiento, no se la convierte en cuenta de plataforma.
 * - [S] OTP obligatorio: se crea con la acción CONFIGURE_TOTP, así que en
 *   el primer login Keycloak obliga a registrar el autenticador. Desde ahí,
 *   el flujo de login del realm pide el código siempre.
 * - Contraseña: si viene, queda permanente; si no, se genera una temporal.
 *
 * No escribe en el registro de auditoría de la aplicación: lo corre una
 * persona con acceso a la cuenta de servicio de Keycloak, y Keycloak ya
 * registra el alta en sus eventos de administración (adminEventsEnabled).
 */
@Injectable()
export class UsuarioPlataformaService {
  private readonly logger = new Logger(UsuarioPlataformaService.name);

  constructor(private readonly keycloakAdmin: KeycloakAdminService) {}

  async asegurar(
    dto: CrearUsuarioPlataformaDto,
    password?: string,
  ): Promise<ResultadoUsuarioPlataforma> {
    const perfil = {
      email: dto.email,
      firstName: dto.nombre,
      lastName: dto.apellido,
    };
    const existente = await this.keycloakAdmin.findUserByUsername(dto.username);

    if (existente) {
      if (existente.attributes?.tenant_id?.length) {
        throw new ConflictException(
          `El usuario ${dto.username} pertenece a un establecimiento: no puede ser un usuario de plataforma`,
        );
      }
      const perfilCompletado =
        !existente.email || !existente.firstName || !existente.lastName
          ? await this.keycloakAdmin.completarPerfil(existente.id, perfil)
          : false;
      await this.keycloakAdmin.assignRealmRole(existente.id, ROL_PLATAFORMA);
      return { keycloakId: existente.id, creado: false, perfilCompletado };
    }

    const passwordGenerada = password
      ? undefined
      : randomBytes(12).toString('base64url');

    const keycloakId = await this.keycloakAdmin.createUser({
      username: dto.username,
      ...perfil,
      temporaryPassword: password ?? (passwordGenerada as string),
      temporary: !password,
      requiredActions: ['CONFIGURE_TOTP'],
    });

    try {
      await this.keycloakAdmin.assignRealmRole(keycloakId, ROL_PLATAFORMA);
    } catch (error) {
      // Compensación: sin el rol el usuario no sirve, y el reintento lo
      // encontraría y no lo recrearía.
      try {
        await this.keycloakAdmin.deleteUser(keycloakId);
      } catch (cleanupError) {
        this.logger.error(
          `No se pudo revertir el usuario de plataforma ${keycloakId} en Keycloak tras fallar la asignación del rol. Requiere limpieza manual.`,
          cleanupError instanceof Error ? cleanupError.stack : cleanupError,
        );
      }
      throw error;
    }

    return {
      keycloakId,
      creado: true,
      ...(passwordGenerada ? { passwordGenerada } : {}),
    };
  }
}
