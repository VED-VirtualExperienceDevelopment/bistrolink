import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import { CrearAdministradorDto } from './dto/crear-administrador.dto';

const MENSAJE_NO_EXISTE = 'No existe un establecimiento con ese id';

/** BL-414: respuesta de restablecer la contraseña (se muestra una sola vez). */
export interface ContrasenaRestablecida {
  id: string;
  temporaryPassword: string;
  sesionesCerradas: boolean;
}

/** BL-414: el Administrador nuevo, con su contraseña temporal (una sola vez). */
export interface AdministradorCreado {
  id: string;
  username: string | null;
  nombre: string | null;
  apellido: string | null;
  email: string | null;
  temporaryPassword: string;
}

/**
 * BL-414: recuperar el acceso del Administrador de un establecimiento (rol
 * PLATAFORMA), para cuando el único Administrador perdió la contraseña o se
 * fue del restaurante (RF.19 exige al menos uno), sin entrar a la consola de
 * Keycloak.
 *
 * Reusa UsuariosService, el mismo de la pantalla de Usuarios del
 * restaurante: contraseña temporal de 16 caracteres que Keycloak pide
 * cambiar, cierre de sesiones, alta en Keycloak y en `usuario` con
 * compensación si algo falla. La diferencia es la auditoría: una sola
 * entrada ESTABLECIMIENTO_ADMIN_*, con el usuario de plataforma como actor.
 *
 * Aislamiento: todo corre en el contexto del tenant de la ruta (RLS), así
 * que un usuario de otro establecimiento no aparece (404). Restablecer solo
 * toma Administradores (soloRol): un Mozo responde el mismo 404. Funciona
 * también con el establecimiento suspendido, para dejarlo listo antes de
 * reactivarlo.
 */
@Injectable()
export class AccesoAdministradorService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly usuarios: UsuariosService,
  ) {}

  async restablecerContrasena(
    tenantId: string,
    usuarioId: string,
    actor: { id: string },
  ): Promise<ContrasenaRestablecida> {
    await this.leerEstablecimiento(tenantId);
    return this.usuarios.restablecerContrasena(tenantId, actor.id, usuarioId, {
      accionAuditoria:
        AuditAction.ESTABLECIMIENTO_ADMIN_CONTRASENA_RESTABLECIDA,
      soloRol: 'ADMIN',
    });
  }

  async crear(
    tenantId: string,
    dto: CrearAdministradorDto,
    actor: { id: string },
  ): Promise<AdministradorCreado> {
    const { restauranteId } = await this.leerEstablecimiento(tenantId);
    // El Administrador queda asociado al restaurante: un alta incompleta se
    // completa desde el listado antes de agregarle uno.
    if (!restauranteId) {
      throw new ConflictException(
        'El establecimiento todavía no tiene restaurante: completá el alta antes de agregar un Administrador',
      );
    }
    const usuario = await this.usuarios.crear(
      tenantId,
      actor.id,
      {
        username: dto.username,
        email: dto.email,
        nombre: dto.nombre,
        apellido: dto.apellido,
        rol: 'ADMIN',
        restauranteId,
      },
      { accionAuditoria: AuditAction.ESTABLECIMIENTO_ADMIN_CREADO },
    );
    // Solo lo que la pantalla necesita: sin keycloakId ni tenantId.
    return {
      id: usuario.id,
      username: usuario.username,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      email: usuario.email,
      temporaryPassword: usuario.temporaryPassword,
    };
  }

  /** 404 si el establecimiento no existe; si existe, su restaurante (o null). */
  private async leerEstablecimiento(
    tenantId: string,
  ): Promise<{ restauranteId: string | null }> {
    const datos = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true },
        });
        if (!tenant) return null;
        const restaurante = await tx.restaurante.findUnique({
          where: { tenantId },
          select: { id: true },
        });
        return { restauranteId: restaurante?.id ?? null };
      },
    );
    if (!datos) {
      throw new NotFoundException(MENSAJE_NO_EXISTE);
    }
    return datos;
  }
}
