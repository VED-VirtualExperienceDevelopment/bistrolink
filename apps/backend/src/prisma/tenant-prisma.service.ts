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
 * REVERT (BL-XXX, corrige regresión introducida en BL-133): este servicio
 * SÍ debe usar RUNTIME_DATABASE_URL, no DATABASE_URL. Es una separación de
 * roles intencional: DATABASE_URL apunta al rol usado por Prisma CLI para
 * migraciones (necesita permisos de owner/DDL, y en local ES superusuario:
 * rolsuper=t, rolbypassrls=t). RUNTIME_DATABASE_URL apunta a un rol
 * restringido (NOSUPERUSER, NOBYPASSRLS) que sí respeta las políticas RLS.
 * Si este servicio usa el rol equivocado (DATABASE_URL), el aislamiento
 * multi-tenant queda completamente bypasseado sin que ningún error lo
 * avise — se detectó porque los tests e2e de aislamiento (TC-I-005,
 * TC-I-007) empezaron a fallar tras el cambio incorrecto de BL-133.
 * El error de BL-133 fue asumir que la variable "nunca existió" solo
 * porque no estaba en .env.example ni en Railway — sí existía en el
 * .env real de desarrollo, simplemente nunca se propagó a esos otros
 * dos lugares. Ver .env.example y variables de Railway, actualizados
 * en el mismo cambio que este revert.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  private readonly prisma = new PrismaClient({
    datasourceUrl: process.env.RUNTIME_DATABASE_URL,
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
