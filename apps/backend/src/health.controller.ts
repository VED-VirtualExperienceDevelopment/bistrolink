import { Controller, Get } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

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

// SELECT version() devuelve el string completo del build, ej:
// "PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on x86_64-pc-linux-gnu,
// compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit" — para este endpoint
// solo interesa "PostgreSQL 18.6" (qué versión estamos corriendo), no el
// detalle de SO/compilador. Si el formato no matchea (versión de Postgres
// que cambie el string de alguna forma inesperada), se devuelve el string
// completo tal cual en vez de fallar, para no perder la información.
function parsePostgresVersion(raw: string): string {
  const match = raw.match(/^PostgreSQL\s+\S+/);
  return match ? match[0] : raw;
}

type LastMigration =
  { name: string; label: string; appliedAt: string } | 'unavailable';

// Prisma nombra las migraciones como "YYYYMMDDHHMMSS_descripcion_snake_case"
// (lo genera "prisma migrate dev --name ..." en la máquina del dev, no
// nosotros) — y ese nombre ES la clave con la que Prisma la trackea en
// _prisma_migrations. NUNCA se renombra el campo "name" real (rompería el
// historial de migrate deploy en cualquier base que ya la tenga aplicada
// con el nombre original). Esto solo arma un "label" legible aparte, para
// mostrar en el endpoint — mismo criterio de legibilidad que usamos para
// TCMS_BUILD/GIT_SHA/NEXT_PUBLIC_APP_VERSION, pero sin tocar el dato real.
function formatMigrationLabel(name: string): string {
  const match = name.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_(.+)$/);
  if (!match) return name;
  const [, year, month, day, hour, minute, , description] = match;
  return `${year}-${month}-${day}_${hour}-${minute} — ${description.replace(/_/g, ' ')}`;
}

// El Dockerfile copia apps/backend/prisma/ (con migrations/ incluida) al
// stage de producción en /app/prisma — y con WORKDIR /app + "node
// dist/main.js", process.cwd() ya es /app en runtime. Localmente
// (apps/backend, "npm run start:dev") también resuelve bien, porque el cwd
// ahí también es la raíz del workspace del backend. Los nombres de carpeta
// de Prisma empiezan con timestamp (YYYYMMDDHHmmss_...), así que el orden
// alfabético coincide con el cronológico — el último orden alfabético es
// la migración más reciente que existe en el código desplegado.
const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

function getLatestMigrationOnDisk(): string | null {
  try {
    const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    return names.length > 0 ? names[names.length - 1] : null;
  } catch {
    // Carpeta ausente (ej. corriendo fuera del contenedor/workspace
    // esperado) — no se puede confirmar, no se asume nada.
    return null;
  }
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
      postgres = parsePostgresVersion(version);
    } catch {
      postgres = 'unavailable';
    }

    // "¿estamos usando la última versión de la base de datos?" en el sentido
    // de esquema/migraciones (no de motor de Postgres) se responde acá: la
    // tabla _prisma_migrations es la que Prisma mantiene automáticamente en
    // cada "prisma migrate deploy", con una fila por migración y su
    // timestamp real de aplicación. finished_at IS NOT NULL filtra
    // migraciones que arrancaron pero fallaron/quedaron a medias — esas no
    // cuentan como "aplicada". Se compara contra el disco más abajo, en
    // "upToDate".
    let lastMigration: LastMigration = 'unavailable';
    try {
      const rows = await getDiagnosticClient().$queryRawUnsafe<
        { migration_name: string; finished_at: Date | null }[]
      >(
        `SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`,
      );
      if (rows.length > 0 && rows[0].finished_at) {
        lastMigration = {
          name: rows[0].migration_name,
          label: formatMigrationLabel(rows[0].migration_name),
          appliedAt: rows[0].finished_at.toISOString(),
        };
      }
    } catch {
      lastMigration = 'unavailable';
    }

    return {
      api: process.env.APP_VERSION ?? 'unknown',
      postgres,
      lastMigration,
      // true/false solo cuando se pudo leer AMBOS lados de la comparación
      // (DB y disco); si cualquiera de los dos falló, 'unavailable' en vez
      // de asumir un resultado — un false positivo acá es peor que no saber.
      upToDate: (() => {
        const latestOnDisk = getLatestMigrationOnDisk();
        if (lastMigration === 'unavailable' || latestOnDisk === null) {
          return 'unavailable';
        }
        return lastMigration.name === latestOnDisk;
      })(),
    };
  }
}
