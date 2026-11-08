import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KeycloakAdminService } from '../keycloak-admin/keycloak-admin.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AprovisionamientoService } from './aprovisionamiento.service';
import { UsuarioPlataformaService } from './usuario-plataforma.service';
import { EstablecimientosService } from './establecimientos.service';
import { FichaEstablecimientoService } from './ficha-establecimiento.service';
import { DatosEstablecimientoService } from './datos-establecimiento.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { TenantEstadoModule } from '../tenant-estado/tenant-estado.module';
import { SuspensionEstablecimientoService } from './suspension-establecimiento.service';
import { AccesoAdministradorService } from './acceso-administrador.service';
import { EliminacionEstablecimientoService } from './eliminacion-establecimiento.service';

/**
 * BL-163 (HU-027): servicios de plataforma, fuera de cualquier tenant.
 *
 * - AprovisionamientoService: alta de establecimientos (script
 *   aprovisionar-establecimiento.ts y endpoint de PlataformaApiModule).
 * - UsuarioPlataformaService: alta de usuarios con rol PLATAFORMA (script
 *   crear-usuario-plataforma.ts).
 * - EstablecimientosService: listado para la pantalla de plataforma.
 * - FichaEstablecimientoService (BL-411): ficha de un establecimiento. Usa
 *   UsuariosService (sin su controller) para las cuentas y el último
 *   ingreso, con la misma lógica que la pantalla de Usuarios.
 * - DatosEstablecimientoService (BL-412): corregir los datos. Se exporta
 *   para que HU-020 (BL-72) lo use desde la configuración del restaurante.
 * - SuspensionEstablecimientoService (BL-413): suspender y reactivar. Usa
 *   TenantEstadoModule para invalidar la caché del estado.
 * - AccesoAdministradorService (BL-414): restablecer la contraseña de un
 *   Administrador o crear uno nuevo, reusando UsuariosService.
 * - EliminacionEstablecimientoService (BL-418): eliminar un establecimiento
 *   creado por error, sin actividad (base y cuentas de Keycloak).
 *
 * Sin controllers a propósito: los scripts levantan solo este módulo
 * (NestFactory.createApplicationContext) y no tienen ThrottlerModule ni
 * Passport. El endpoint está en PlataformaApiModule, que importa la app.
 *
 * KeycloakAdminService y AuditLogService se registran acá igual que en
 * UsuariosModule (no tienen módulo propio).
 */
@Module({
  imports: [PrismaModule, TenantEstadoModule],
  providers: [
    AprovisionamientoService,
    UsuarioPlataformaService,
    EstablecimientosService,
    FichaEstablecimientoService,
    DatosEstablecimientoService,
    SuspensionEstablecimientoService,
    AccesoAdministradorService,
    EliminacionEstablecimientoService,
    UsuariosService,
    KeycloakAdminService,
    AuditLogService,
  ],
  exports: [
    AprovisionamientoService,
    UsuarioPlataformaService,
    EstablecimientosService,
    FichaEstablecimientoService,
    DatosEstablecimientoService,
    SuspensionEstablecimientoService,
    AccesoAdministradorService,
    EliminacionEstablecimientoService,
  ],
})
export class PlataformaModule {}
