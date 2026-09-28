import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PagosController } from './pagos.controller';
import { PagosService } from './pagos.service';
import { FakePagoGateway } from './gateways/fake.gateway';
import { MercadoPagoGateway } from './gateways/mercadopago.gateway';
import { PagoGatewayFactory } from './gateways/pago-gateway.factory';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PagosController],
  providers: [
    PagosService,
    FakePagoGateway,
    MercadoPagoGateway,
    PagoGatewayFactory,
  ],
})
export class PagosModule {}
