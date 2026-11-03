import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';

/** Respuesta de POST /admin/configuracion/privacidad/anonimizar-receptor. */
export interface ResultadoAnonimizacion {
  /** Pedidos del local que tenían ese RUT (0 si no había ninguno). */
  pedidos: number;
}

/**
 * HU-009 (BL-453): pedido de supresión de un comensal que pidió e-Factura
 * (Ley 18.331, art. 15). El administrador ingresa el RUT y en los pedidos
 * de su local con ese RUT se borran el RUT y la razón social, y queda la
 * fecha de la anonimización.
 *
 * - Los CFE emitidos y los montos no se tocan: se conservan 5 años por la
 *   obligación fiscal (Res. DGI 798/2012) y ya están informados a DGI.
 * - Solo el propio tenant (RLS): un local no puede anonimizar pedidos de
 *   otro.
 * - Auditoría PEDIDO_RECEPTOR_ANONIMIZADO en la misma transacción, con la
 *   cantidad de pedidos y nunca el RUT (sería volver a guardarlo).
 */
@Injectable()
export class AnonimizarReceptorService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async anonimizar(
    tenantId: string,
    rut: string,
    actor: { id: string },
    ahora: Date = new Date(),
  ): Promise<ResultadoAnonimizacion> {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const { count } = await tx.pedido.updateMany({
        where: { tenantId, receptorRut: rut },
        data: {
          receptorRut: null,
          receptorRazonSocial: null,
          receptorAnonimizadoEn: ahora,
        },
      });

      await this.auditLog.registrarEnTx(tx, {
        action: AuditAction.PEDIDO_RECEPTOR_ANONIMIZADO,
        tenantId,
        actorKeycloakId: actor.id,
        detalle: { pedidos: count },
      });

      return { pedidos: count };
    });
  }
}
