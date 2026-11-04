import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ResumenVentasService } from './resumen-ventas.service';
import { ResumenVentasJob } from './resumen-ventas.job';

/**
 * HU-012 (BL-219): resumen de ventas por hora para el dashboard de reportes.
 * Lo importa PedidosModule, que lo recalcula al aprobarse un pago. Es un
 * módulo aparte (y no ReportesModule) para no crear una dependencia circular
 * con PedidosModule.
 */
@Module({
  imports: [PrismaModule],
  providers: [ResumenVentasService, ResumenVentasJob],
  exports: [ResumenVentasService],
})
export class ResumenVentasModule {}
