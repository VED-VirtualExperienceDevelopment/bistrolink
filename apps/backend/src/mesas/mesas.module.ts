import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PedidosModule } from '../pedidos/pedidos.module';
import { MesasController } from './mesas.controller';
import { MesasService } from './mesas.service';
import { MesaThrottlerGuard } from './mesa-throttler.guard';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PedidosModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1 }]),
  ],
  controllers: [MesasController],
  providers: [MesasService, MesaThrottlerGuard],
})
export class MesasModule {}
