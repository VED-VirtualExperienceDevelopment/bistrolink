import { Module } from '@nestjs/common';
import { AuthComensalController } from './auth-comensal.controller';
import { AuthComensalService } from './auth-comensal.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuthComensalController],
  providers: [AuthComensalService],
})
export class AuthComensalModule {}
