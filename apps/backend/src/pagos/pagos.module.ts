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
import { CobrosController } from './efectivo/cobros.controller';
import { CobroEfectivoService } from './efectivo/cobro-efectivo.service';
import { CancelacionPendienteService } from './efectivo/cancelacion-pendiente.service';
import { SolicitudEfectivoService } from './efectivo/solicitud-efectivo.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CancelacionPedidoController } from './cancelacion/cancelacion-pedido.controller';
import { CancelacionPedidoService } from './cancelacion/cancelacion-pedido.service';
import { PosModule } from '../pos/pos.module';

@Module({
  // BL-311: QrMesaModule para MesaQrGuard en el pago (RD.05).
  // HU-011 (BL-488): PosModule, para anular la venta en el POS al cancelar.
  imports: [
    PrismaModule,
    AuthModule,
    CfeModule,
    PedidosModule,
    QrMesaModule,
    PosModule,
  ],
  controllers: [
    PagosController,
    PagosWebhookController,
    PlexoWebhookController,
    // HU-031 (BL-201): cobro en efectivo (mozo y administrador).
    CobrosController,
    // HU-024 (BL-104): cancelación de pedidos pagados y devolución.
    CancelacionPedidoController,
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
    CobroEfectivoService,
    CancelacionPendienteService,
    // HU-031b (BL-442): el comensal pide pagar en efectivo.
    SolicitudEfectivoService,
    CancelacionPedidoService,
    AuditLogService,
  ],
})
export class PagosModule {}
