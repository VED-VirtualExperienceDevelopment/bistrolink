import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LinkPagoController } from './link-pago.controller';
import { LinkPagoService } from './link-pago.service';

/**
 * HU-033 (BL-203): link de pago. Vive aparte para que lo use
 * auth-comensal sin depender de PagosModule.
 */
@Module({
  imports: [PrismaModule],
  controllers: [LinkPagoController],
  providers: [LinkPagoService, AuditLogService],
  exports: [LinkPagoService],
})
export class LinkPagoModule {}
