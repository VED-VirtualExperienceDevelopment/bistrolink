import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CfeService } from './cfe.service';
import { SurtecClient } from './surtec.client';
import { EstadoDgiService } from './estado-dgi/estado-dgi.service';
import { EstadoDgiJob } from './estado-dgi/estado-dgi.job';

/**
 * Facturación electrónica (Surtec): emisión del CFE (BL-311, BL-453) y
 * consulta de su estado ante la DGI (BL-455). Un solo SurtecClient para los
 * dos: comparten el token.
 */
@Module({
  imports: [PrismaModule],
  providers: [CfeService, SurtecClient, EstadoDgiService, EstadoDgiJob],
  exports: [CfeService],
})
export class CfeModule {}
