import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PedidosModule } from '../pedidos/pedidos.module';
import { QrMesaModule } from '../qr-mesa/qr-mesa.module';
import { MesasController } from './mesas.controller';
import { MesasService } from './mesas.service';
import { MesasQrService } from './mesas-qr.service';
import { MesaThrottlerGuard } from './mesa-throttler.guard';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PedidosModule,
    QrMesaModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1 }]),
  ],
  controllers: [MesasController],
  providers: [MesasService, MesasQrService, MesaThrottlerGuard],
})
export class MesasModule {}
