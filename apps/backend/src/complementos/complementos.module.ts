import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MenuModule } from '../menu/menu.module';
import { QrMesaModule } from '../qr-mesa/qr-mesa.module';
import { TenantEstadoModule } from '../tenant-estado/tenant-estado.module';
import { ComplementosController } from './complementos.controller';
import { ComplementosService } from './complementos.service';
import { ReglasComplementoService } from './reglas-complemento.service';
import { ReglasComplementoJob } from './reglas-complemento.job';

/**
 * HU-046 (BL-552): sugerencia de complementos antes de pagar. Las reglas de
 * asociación (con su job nocturno) y el endpoint público. MenuModule aporta
 * StorageService (las fotos de los platos sugeridos).
 */
@Module({
  imports: [PrismaModule, MenuModule, QrMesaModule, TenantEstadoModule],
  controllers: [ComplementosController],
  providers: [
    ComplementosService,
    ReglasComplementoService,
    ReglasComplementoJob,
  ],
  exports: [ReglasComplementoService],
})
export class ComplementosModule {}
