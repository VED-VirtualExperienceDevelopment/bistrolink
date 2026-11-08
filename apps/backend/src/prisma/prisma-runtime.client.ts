import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente de Prisma ÚNICO para la aplicación, con el rol restringido de
 * RUNTIME_DATABASE_URL (NOSUPERUSER, NOBYPASSRLS: respeta las políticas RLS).
 *
 * Por qué existe: TenantPrismaService es por request (Scope.REQUEST) y antes
 * creaba su propio `new PrismaClient()` en cada request. Cada cliente abre su
 * propio pool de conexiones a Postgres y nadie lo cerraba: con muchas
 * requests seguidas se agotaban las conexiones de la base («Too many database
 * connections opened», visto en el job de integración del CI) y cada request
 * pagaba además el costo de abrir una conexión nueva.
 *
 * Ahora este provider es singleton (scope por defecto): un solo pool para
 * toda la app, que TenantPrismaService recibe por inyección. Al cerrar la
 * aplicación (app.close(), apagado del contenedor) desconecta el pool.
 */
@Injectable()
export class PrismaRuntimeClient
  extends PrismaClient
  implements OnModuleDestroy
{
  constructor() {
    super({ datasourceUrl: process.env.RUNTIME_DATABASE_URL });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
