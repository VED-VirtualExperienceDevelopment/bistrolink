import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ComprobantesController } from './comprobantes.controller';
import { ComprobantesService } from './comprobantes.service';

/** HU-009 (BL-455): GET /admin/comprobantes, solo ADMIN. */
@Module({
  imports: [PrismaModule],
  controllers: [ComprobantesController],
  providers: [ComprobantesService],
})
export class ComprobantesModule {}
