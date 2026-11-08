import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

@Injectable()
export class RestaurantesService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /**
   * Lista los restaurantes del tenant autenticado. RLS ya filtra por
   * tenant_id a nivel de fila (misma política que el resto de las tablas
   * dependientes, ver Anexo 6 §4.2) — el where explícito es defensa en
   * profundidad, no la única barrera.
   */
  async listar(tenantId: string) {
    return this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.restaurante.findMany({
        where: { tenantId },
        select: {
          id: true,
          nombre: true,
          direccion: true,
          timezone: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }
}
