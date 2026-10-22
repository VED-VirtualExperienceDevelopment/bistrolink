import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KeycloakAdminService } from '../keycloak-admin/keycloak-admin.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AprovisionamientoService } from './aprovisionamiento.service';
import { UsuarioPlataformaService } from './usuario-plataforma.service';
import { EstablecimientosService } from './establecimientos.service';
import { FichaEstablecimientoService } from './ficha-establecimiento.service';
import { UsuariosService } from '../usuarios/usuarios.service';

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
 *
 * Sin controllers a propósito: los scripts levantan solo este módulo
 * (NestFactory.createApplicationContext) y no tienen ThrottlerModule ni
 * Passport. El endpoint está en PlataformaApiModule, que importa la app.
 *
 * KeycloakAdminService y AuditLogService se registran acá igual que en
 * UsuariosModule (no tienen módulo propio).
 */
@Module({
  imports: [PrismaModule],
  providers: [
    AprovisionamientoService,
    UsuarioPlataformaService,
    EstablecimientosService,
    FichaEstablecimientoService,
    UsuariosService,
    KeycloakAdminService,
    AuditLogService,
  ],
  exports: [
    AprovisionamientoService,
    UsuarioPlataformaService,
    EstablecimientosService,
    FichaEstablecimientoService,
  ],
})
export class PlataformaModule {}
