import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CfeModule } from '../cfe/cfe.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ComprobantesController } from './comprobantes.controller';
import { ComprobantesService } from './comprobantes.service';

/**
 * HU-009 (BL-455): GET /admin/comprobantes, solo ADMIN.
 * HU-023 (BL-96): pendientes de emisión y «Reintentar ahora».
 */
@Module({
  imports: [PrismaModule, CfeModule],
  controllers: [ComprobantesController],
  providers: [ComprobantesService, AuditLogService],
})
export class ComprobantesModule {}
