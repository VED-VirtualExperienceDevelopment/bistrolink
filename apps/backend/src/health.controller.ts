import { Controller, Get } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Cliente Prisma dedicado y liviano, solo para diagnóstico (SELECT version()).
// A propósito NO usa TenantPrismaService: ese servicio es REQUEST-scoped y
// exige un tenantId para correr cualquier query (vía runInTenantContext),
// lo cual no tiene sentido para un healthcheck que no representa a ningún
// tenant. SELECT version() es metadata del servidor, no dato aislado por RLS,
// así que no hay ningún problema de seguridad en consultarla fuera del
// contexto de tenant.
const diagnosticClient = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }

  @Get('version')
  async version() {
    let postgres: string | null = null;
    try {
      const [{ version }] =
        await diagnosticClient.$queryRawUnsafe<{ version: string }[]>(
          'SELECT version()',
        );
      postgres = version;
    } catch {
      postgres = 'unavailable';
    }

    return {
      api: process.env.APP_VERSION ?? 'unknown',
      postgres,
    };
  }
}
