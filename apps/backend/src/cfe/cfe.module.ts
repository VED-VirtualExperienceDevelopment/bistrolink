import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CfeService } from './cfe.service';
import { SurtecClient } from './surtec.client';

@Module({
  imports: [PrismaModule],
  providers: [CfeService, SurtecClient],
  exports: [CfeService],
})
export class CfeModule {}
