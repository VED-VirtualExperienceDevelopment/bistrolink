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

@Module({
  // BL-413: TenantEstadoModule, para WsAuthService.
  // HU-012 (BL-219): ResumenVentasModule, para recalcular el resumen de
  // ventas al aprobarse un pago.
  imports: [
    PrismaModule,
    AuthModule,
    QrMesaModule,
    TenantEstadoModule,
    ResumenVentasModule,
  ],
  controllers: [PedidosController],
  providers: [
    PedidosService,
    KdsGateway,
    WsAuthService,
    PedidosTransicionService,
  ],
  // BL-311: PagosModule usa PedidosService para confirmar el pago del pedido.
  exports: [KdsGateway, PedidosService],
})
export class PedidosModule {}
