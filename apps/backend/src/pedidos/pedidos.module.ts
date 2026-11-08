import { Module } from '@nestjs/common';
import { PedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';
import { KdsGateway } from './kds.gateway';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { WsAuthService } from './ws-auth.service';
import { PedidosTransicionService } from './pedidos-transicion.service';
import { QrMesaModule } from '../qr-mesa/qr-mesa.module';
import { TenantEstadoModule } from '../tenant-estado/tenant-estado.module';
import { ResumenVentasModule } from '../reportes/resumen-ventas.module';
import { MenuModule } from '../menu/menu.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { DescuentoStockService } from '../stock/descuento-stock.service';

@Module({
  // BL-413: TenantEstadoModule, para WsAuthService.
  // HU-012 (BL-219): ResumenVentasModule, para recalcular el resumen de
  // ventas al aprobarse un pago.
  // HU-015 (BL-120): MenuModule, para avisar a la carta del comensal cuando
  // un ítem se agota.
  imports: [
    PrismaModule,
    AuthModule,
    QrMesaModule,
    TenantEstadoModule,
    ResumenVentasModule,
    MenuModule,
  ],
  controllers: [PedidosController],
  providers: [
    PedidosService,
    KdsGateway,
    WsAuthService,
    PedidosTransicionService,
    // HU-015 (BL-120): descuento de stock al confirmarse el pago.
    DescuentoStockService,
    AuditLogService,
  ],
  // BL-311: PagosModule usa PedidosService para confirmar el pago del pedido.
  exports: [KdsGateway, PedidosService],
})
export class PedidosModule {}
