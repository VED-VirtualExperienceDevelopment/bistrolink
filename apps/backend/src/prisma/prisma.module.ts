import { Module } from '@nestjs/common';
import { PrismaRuntimeClient } from './prisma-runtime.client';
import { TenantPrismaService } from './tenant-prisma.service';

// PrismaRuntimeClient es singleton: un solo pool de conexiones para toda la
// app, compartido por todas las instancias (por request) de
// TenantPrismaService.
@Module({
  providers: [PrismaRuntimeClient, TenantPrismaService],
  exports: [TenantPrismaService],
})
export class PrismaModule {}
