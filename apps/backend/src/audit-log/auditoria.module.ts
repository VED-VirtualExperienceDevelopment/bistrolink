import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditoriaController } from './auditoria.controller';
import { AuditoriaConsultaService } from './auditoria-consulta.service';

/** HU-035 (BL-205): consulta del registro de auditoría. */
@Module({
  imports: [PrismaModule],
  controllers: [AuditoriaController],
  providers: [AuditoriaConsultaService],
})
export class AuditoriaModule {}
