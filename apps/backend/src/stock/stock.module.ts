import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PedidosModule } from '../pedidos/pedidos.module';
import { MenuModule } from '../menu/menu.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

/**
 * HU-015 (BL-120): GET y PATCH /admin/stock y GET /admin/stock/alertas,
 * solo ADMIN. El descuento al confirmarse el pago (DescuentoStockService)
 * vive en PedidosModule, que es quien confirma los pagos.
 */
@Module({
  imports: [PrismaModule, PedidosModule, MenuModule],
  controllers: [StockController],
  providers: [StockService, AuditLogService],
})
export class StockModule {}
