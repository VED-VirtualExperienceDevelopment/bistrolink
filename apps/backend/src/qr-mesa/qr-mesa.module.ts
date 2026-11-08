import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QrMesaTokenService } from './qr-mesa-token.service';
import { QrMesaAccesoService } from './qr-mesa-acceso.service';

/**
 * HU-034 (BL-204): módulo propio para el QR de mesa. Lo importan mesas
 * (admin), menú (público), auth-comensal y pedidos (MesaQrGuard). Vive
 * aparte para no crear una dependencia circular entre MesasModule y
 * PedidosModule.
 */
@Module({
  imports: [PrismaModule],
  providers: [QrMesaTokenService, QrMesaAccesoService],
  exports: [QrMesaTokenService, QrMesaAccesoService],
})
export class QrMesaModule {}
