import { Module } from '@nestjs/common';
import { QrMesaTokenService } from './qr-mesa-token.service';

/**
 * HU-034 (BL-204): módulo propio para el token del QR de mesa. Lo importan
 * mesas (admin), menú (público), auth-comensal y pedidos (MesaQrGuard).
 * Vive aparte para no crear una dependencia circular entre MesasModule y
 * PedidosModule.
 */
@Module({
  providers: [QrMesaTokenService],
  exports: [QrMesaTokenService],
})
export class QrMesaModule {}
