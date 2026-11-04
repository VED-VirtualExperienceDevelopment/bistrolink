import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ConfiguracionController } from './configuracion.controller';
import { ConfiguracionEstablecimientoService } from './configuracion-establecimiento.service';
import { AnonimizarReceptorService } from './anonimizar-receptor.service';

/**
 * HU-020 (BL-72): GET y PATCH /admin/configuracion, solo ADMIN.
 * HU-009 (BL-453): POST /admin/configuracion/privacidad/anonimizar-receptor.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ConfiguracionController],
  providers: [
    ConfiguracionEstablecimientoService,
    AnonimizarReceptorService,
    AuditLogService,
  ],
})
export class ConfiguracionModule {}
