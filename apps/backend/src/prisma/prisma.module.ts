import { Module } from '@nestjs/common';
import { PrismaRuntimeClient } from './prisma-runtime.client';
import { TenantPrismaService } from './tenant-prisma.service';

// PrismaRuntimeClient es singleton: un solo pool de conexiones para toda la
// app, compartido por todas las instancias (por request) de
// TenantPrismaService.
@Module({
  providers: [PrismaRuntimeClient, TenantPrismaService],
  // HU-032 (BL-202): también se exporta el cliente, para los procesos que
  // corren fuera de un request (ConciliacionPagosJob) y necesitan leer la
  // tabla `tenant`, que no tiene RLS.
  exports: [TenantPrismaService, PrismaRuntimeClient],
})
export class PrismaModule {}
