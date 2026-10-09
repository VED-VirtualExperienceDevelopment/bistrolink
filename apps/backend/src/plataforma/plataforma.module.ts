import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KeycloakAdminService } from '../keycloak-admin/keycloak-admin.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AprovisionamientoService } from './aprovisionamiento.service';
import { UsuarioPlataformaService } from './usuario-plataforma.service';
import { EstablecimientosService } from './establecimientos.service';

/**
 * BL-163 (HU-027): servicios de plataforma, fuera de cualquier tenant.
 *
 * - AprovisionamientoService: alta de establecimientos (script
 *   aprovisionar-establecimiento.ts y endpoint de PlataformaApiModule).
 * - UsuarioPlataformaService: alta de usuarios con rol PLATAFORMA (script
 *   crear-usuario-plataforma.ts).
 * - EstablecimientosService: listado para la pantalla de plataforma.
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
    KeycloakAdminService,
    AuditLogService,
  ],
  exports: [
    AprovisionamientoService,
    UsuarioPlataformaService,
    EstablecimientosService,
  ],
})
export class PlataformaModule {}
