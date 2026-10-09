import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KeycloakAdminService } from '../keycloak-admin/keycloak-admin.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AprovisionamientoService } from './aprovisionamiento.service';

/**
 * BL-163 (HU-027): operaciones de plataforma, fuera de cualquier tenant.
 *
 * Entrega 1: solo el servicio de aprovisionamiento, que usa el script
 * scripts/aprovisionar-establecimiento.ts. Todavía no se importa en
 * AppModule: no expone ninguna ruta. La entrega 2 suma el controller
 * (/plataforma/establecimientos) con su guard de rol PLATAFORMA.
 *
 * KeycloakAdminService y AuditLogService se registran acá igual que en
 * UsuariosModule (no tienen módulo propio).
 */
@Module({
  imports: [PrismaModule],
  providers: [AprovisionamientoService, KeycloakAdminService, AuditLogService],
  exports: [AprovisionamientoService],
})
export class PlataformaModule {}
