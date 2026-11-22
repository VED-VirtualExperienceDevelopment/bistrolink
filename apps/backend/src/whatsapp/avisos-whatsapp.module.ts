import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AvisosWhatsappService } from './avisos-whatsapp.service';
import { EvolutionClienteService } from './evolution-cliente.service';

/**
 * HU-010 (BL-604): avisos por WhatsApp (pago aprobado, pedido listo) y el
 * cliente de Evolution. Aparte de WhatsappModule para que PedidosModule lo
 * use sin una dependencia circular (WhatsappModule importa PedidosModule).
 */
@Module({
  imports: [PrismaModule],
  providers: [AvisosWhatsappService, EvolutionClienteService],
  exports: [AvisosWhatsappService, EvolutionClienteService],
})
export class AvisosWhatsappModule {}
