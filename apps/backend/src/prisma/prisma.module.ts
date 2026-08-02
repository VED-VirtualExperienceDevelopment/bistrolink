import { Module } from '@nestjs/common';
import { TenantPrismaService } from './tenant-prisma.service';

@Module({
  providers: [TenantPrismaService],
  exports: [TenantPrismaService],
})
export class PrismaModule {}
