import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { KdsGateway } from '../pedidos/kds.gateway';

@Injectable()
export class MesasService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly kdsGateway: KdsGateway,
  ) {}

  async llamarMozo(tenantId: string, mesaId: string) {
    const mesa = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.mesa.findUnique({
        where: { id: mesaId },
        select: { id: true, numero: true },
      }),
    );

    if (!mesa) {
      throw new NotFoundException(
        'Mesa no encontrada para este establecimiento',
      );
    }

    this.kdsGateway.emitirLlamado(tenantId, mesa.id, mesa.numero);

    return { ok: true };
  }
}
