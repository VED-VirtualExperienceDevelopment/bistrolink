import { Module } from '@nestjs/common';
import { LinkPagoModule } from '../link-pago/link-pago.module';
import { PedidosModule } from '../pedidos/pedidos.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantEstadoModule } from '../tenant-estado/tenant-estado.module';
import { AvisosWhatsappModule } from './avisos-whatsapp.module';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappService } from './whatsapp.service';

/**
 * HU-010 (BL-112): bot de pedidos para retirar por WhatsApp, con Evolution
 * API. El ThrottlerModule lo registra MesasModule (global).
 */
@Module({
  imports: [
    PrismaModule,
    PedidosModule,
    LinkPagoModule,
    TenantEstadoModule,
    // BL-604: el cliente de Evolution (y los avisos) vienen de acá.
    AvisosWhatsappModule,
  ],
  controllers: [WhatsappWebhookController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
