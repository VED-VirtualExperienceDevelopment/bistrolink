import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ConfiguracionController } from './configuracion.controller';
import { ConfiguracionEstablecimientoService } from './configuracion-establecimiento.service';

/** HU-020 (BL-72): GET y PATCH /admin/configuracion, solo ADMIN. */
@Module({
  imports: [PrismaModule],
  controllers: [ConfiguracionController],
  providers: [ConfiguracionEstablecimientoService, AuditLogService],
})
export class ConfiguracionModule {}
