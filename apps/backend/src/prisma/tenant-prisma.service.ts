import { Injectable, Scope } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Servicio Prisma con scope por request (REQUEST): cada request autenticada
 * obtiene una instancia que ejecuta sus queries dentro de una transacción con
 * SET LOCAL app.tenant_id = '<tenant_id del JWT>'.
 *
 * SET LOCAL solo vale dentro de la transacción activa, así que toda la lógica
 * de un request (o del handler que la use) debe correr a través de
 * runInTenantContext() para que las políticas RLS de la migración
 * 20260802150000_enable_rls tengan de dónde leer current_setting('app.tenant_id').
 *
 * NOTA: nos quedamos en Prisma 6.x (no 7) — ver ticket de upgrade a Prisma 7
 * pendiente. datasourceUrl sigue siendo válido en 6.x; los driver adapters
 * (@prisma/adapter-pg) recién son obligatorios en 7, y hoy mismo tienen un
 * desajuste de versiones entre el paquete del adapter y el client generado,
 * así que no vale la pena introducirlos todavía.
 *
 * NOTA (BL-133): antes leía process.env.RUNTIME_DATABASE_URL, variable que
 * nunca existió en .env.example ni en Railway — no era una separación
 * intencional (por ejemplo, un rol de Postgres con permisos restringidos
 * en runtime), sino un nombre mal escrito. Al pasar datasourceUrl: undefined,
 * Prisma caía de vuelta al valor de env("DATABASE_URL") declarado en el
 * propio schema.prisma, así que funcionaba por una coincidencia silenciosa,
 * no porque el código pidiera la variable correcta. Corregido para leer
 * DATABASE_URL explícitamente, alineado con .env.example, el CI y Railway.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private readonly prisma = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
  });

  async runInTenantContext<T>(
    tenantId: string,
    fn: (tx: PrismaClient) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T> {
    if (!tenantId) {
      throw new Error('runInTenantContext: tenantId requerido');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.tenant_id', $1, true)`,
        tenantId,
      );
      return fn(tx as unknown as PrismaClient);
    }, options);
  }
}
