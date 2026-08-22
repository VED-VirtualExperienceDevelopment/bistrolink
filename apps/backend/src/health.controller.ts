import { Controller, Get } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Cliente Prisma dedicado, solo para diagnóstico (SELECT version()). A
// propósito NO usa TenantPrismaService: ese servicio es REQUEST-scoped y
// exige un tenantId para correr cualquier query (vía runInTenantContext),
// lo cual no tiene sentido para un healthcheck que no representa a ningún
// tenant. SELECT version() es metadata del servidor, no dato aislado por RLS,
// así que no hay ningún problema de seguridad en consultarla fuera del
// contexto de tenant.
//
// Instanciado de forma PEREZOSA (recién en el primer llamado a /version), no
// a nivel de módulo: instanciar PrismaClient dispara la carga del motor
// nativo, y si ese motor no está disponible para el runtime (como pasó con
// el mismatch de binaryTargets en Alpine/OpenSSL — ver schema.prisma), la
// carga falla de forma síncrona y crashea el proceso completo de Node antes
// de que Nest termine de arrancar. Haciéndolo perezoso, un fallo de este
// tipo queda contenido dentro del try/catch de abajo, sin tirar abajo toda
// la app por un endpoint que es puramente de diagnóstico.
let diagnosticClient: PrismaClient | null = null;

function getDiagnosticClient(): PrismaClient {
  if (!diagnosticClient) {
    diagnosticClient = new PrismaClient({
      datasourceUrl: process.env.DATABASE_URL,
    });
  }
  return diagnosticClient;
}

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
        await getDiagnosticClient().$queryRawUnsafe<{ version: string }[]>(
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
