import { Module } from '@nestjs/common';
import { AuthComensalController } from './auth-comensal.controller';
import { AuthComensalService } from './auth-comensal.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QrMesaModule } from '../qr-mesa/qr-mesa.module';

@Module({
  imports: [PrismaModule, QrMesaModule],
  controllers: [AuthComensalController],
  providers: [AuthComensalService],
})
export class AuthComensalModule {}
