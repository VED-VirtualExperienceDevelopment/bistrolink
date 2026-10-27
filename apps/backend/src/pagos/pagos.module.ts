import { PagosWebhookController } from './webhooks/pagos-webhook.controller';
import { PagosWebhookService } from './webhooks/pagos-webhook.service';
import { PlexoGateway } from './gateways/plexo.gateway';
import { PlexoWebhookController } from './webhooks/plexo-webhook.controller';
import { PlexoWebhookService } from './webhooks/plexo-webhook.service';
import { PagosService } from './pagos.service';
import { MercadoPagoGateway } from './gateways/mercadopago.gateway';
import { PagoGatewayFactory } from './gateways/pago-gateway.factory';
import { PagosController } from './pagos.controller';
import { PedidosModule } from '../pedidos/pedidos.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { Module } from '@nestjs/common';
import { CfeModule } from '../cfe/cfe.module';
import { QrMesaModule } from '../qr-mesa/qr-mesa.module';
import { ConciliacionPagosService } from './conciliacion/conciliacion-pagos.service';
import { ConciliacionPagosJob } from './conciliacion/conciliacion-pagos.job';

@Module({
  // BL-311: QrMesaModule para MesaQrGuard en el pago (RD.05).
  imports: [PrismaModule, AuthModule, CfeModule, PedidosModule, QrMesaModule],
  controllers: [
    PagosController,
    PagosWebhookController,
    PlexoWebhookController,
  ],
  providers: [
    PagosService,
    PagosWebhookService,
    MercadoPagoGateway,
    PlexoGateway,
    PagoGatewayFactory,
    PlexoWebhookService,
    // HU-032 (BL-202): vencimiento y conciliación de pagos pendientes.
    ConciliacionPagosService,
    ConciliacionPagosJob,
  ],
})
export class PagosModule {}
