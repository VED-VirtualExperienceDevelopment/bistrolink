import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportesController } from './reportes.controller';
import { ReportesService } from './reportes.service';

/**
 * HU-012 (BL-108): GET /admin/reportes, solo ADMIN. Lee las tablas de
 * resumen que mantiene ResumenVentasModule (BL-219).
 */
@Module({
  imports: [PrismaModule],
  controllers: [ReportesController],
  providers: [ReportesService],
})
export class ReportesModule {}
