import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import type { ResultadoAnonimizacion } from './anonimizar-receptor.service';

/**
 * HU-040 (BL-210): pedido de supresión de un comensal que dejó su nombre y
 * su contacto en un pedido para retirar (Ley 18.331, art. 15). El
 * administrador ingresa el contacto y en los pedidos de su local con ese
 * contacto se borran el nombre y el contacto, y queda la fecha.
 *
 * - El pedido, sus líneas, el código de retiro, los pagos y los montos no
 *   se tocan.
 * - Solo el propio tenant (RLS).
 * - Auditoría PEDIDO_RETIRO_ANONIMIZADO en la misma transacción, con la
 *   cantidad de pedidos y nunca el contacto (sería volver a guardarlo).
 */
@Injectable()
export class AnonimizarRetiroService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async anonimizar(
    tenantId: string,
    contacto: string,
    actor: { id: string },
    ahora: Date = new Date(),
  ): Promise<ResultadoAnonimizacion> {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const { count } = await tx.pedido.updateMany({
        where: { tenantId, retiroContacto: contacto },
        data: {
          retiroNombre: null,
          retiroContacto: null,
          retiroAnonimizadoEn: ahora,
        },
      });

      await this.auditLog.registrarEnTx(tx, {
        action: AuditAction.PEDIDO_RETIRO_ANONIMIZADO,
        tenantId,
        actorKeycloakId: actor.id,
        detalle: { pedidos: count },
      });

      return { pedidos: count };
    });
  }
}
