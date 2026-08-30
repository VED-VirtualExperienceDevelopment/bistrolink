import { Module } from '@nestjs/common';
import { PedidosController } from './pedidos.controller';
import { PedidosService } from './pedidos.service';
import { KdsGateway } from './kds.gateway';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { WsAuthService } from './ws-auth.service';
import { PedidosTransicionService } from './pedidos-transicion.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PedidosController],
  providers: [
    PedidosService,
    KdsGateway,
    WsAuthService,
    PedidosTransicionService,
  ],
})
export class PedidosModule {}
