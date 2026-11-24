import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QrMesaModule } from '../qr-mesa/qr-mesa.module';
import { ValoracionPedidoController } from './valoracion-pedido.controller';
import { ValoracionesAdminController } from './valoraciones-admin.controller';
import { ValoracionesService } from './valoraciones.service';

/**
 * HU-050 (BL-558): valoración privada del pedido. QrMesaModule, para
 * MesaQrGuard (RD.05). ValoracionThrottlerGuard usa el ThrottlerModule
 * global que registra MesasModule.
 */
@Module({
  imports: [PrismaModule, AuthModule, QrMesaModule],
  controllers: [ValoracionPedidoController, ValoracionesAdminController],
  providers: [ValoracionesService],
})
export class ValoracionesModule {}
