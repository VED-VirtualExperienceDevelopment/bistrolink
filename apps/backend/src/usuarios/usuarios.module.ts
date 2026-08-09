import { Module } from '@nestjs/common';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';
import { KeycloakAdminService } from '../keycloak-admin/keycloak-admin.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UsuariosController],
  providers: [UsuariosService, KeycloakAdminService, AuditLogService],
})
export class UsuariosModule {}
