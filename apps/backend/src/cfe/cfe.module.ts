import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CfeService } from './cfe.service';
import { SurtecClient } from './surtec.client';
import { EstadoDgiService } from './estado-dgi/estado-dgi.service';
import { EstadoDgiJob } from './estado-dgi/estado-dgi.job';
import { ConciliacionCfeService } from './conciliacion-cfe/conciliacion-cfe.service';
import { ConciliacionCfeJob } from './conciliacion-cfe/conciliacion-cfe.job';
import { AlmacenCfe } from './respaldo-pdf/almacen-cfe';
import { RespaldoPdfService } from './respaldo-pdf/respaldo-pdf.service';
import { RespaldoPdfJob } from './respaldo-pdf/respaldo-pdf.job';

/**
 * Facturación electrónica (Surtec): emisión del CFE (BL-311, BL-453),
 * consulta de su estado ante la DGI (BL-455) y conciliación de los CFE
 * pendientes (BL-96), y copia del PDF en S3 (BL-454). Un solo SurtecClient:
 * comparten el token.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    CfeService,
    SurtecClient,
    EstadoDgiService,
    EstadoDgiJob,
    ConciliacionCfeService,
    ConciliacionCfeJob,
    AlmacenCfe,
    RespaldoPdfService,
    RespaldoPdfJob,
  ],
  exports: [CfeService],
})
export class CfeModule {}
