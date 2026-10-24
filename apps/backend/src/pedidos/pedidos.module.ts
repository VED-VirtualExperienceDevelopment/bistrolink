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

@Module({
  // BL-413: TenantEstadoModule, para WsAuthService.
  imports: [PrismaModule, AuthModule, QrMesaModule, TenantEstadoModule],
  controllers: [PedidosController],
  providers: [
    PedidosService,
    KdsGateway,
    WsAuthService,
    PedidosTransicionService,
  ],
  exports: [KdsGateway],
})
export class PedidosModule {}
