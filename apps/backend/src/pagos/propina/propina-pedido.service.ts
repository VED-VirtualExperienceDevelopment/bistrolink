import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import {
  calcularTotales,
  sumarConsumo,
  topeDePropina,
} from '../totales-pedido';
import { ElegirPropinaDto } from './elegir-propina.dto';

export interface PropinaElegida {
  pedidoId: string;
  propinaPorcentaje: number | null;
  propinaMonto: number | null;
  /** Consumo, propina y total, con 2 decimales (calculados en el backend). */
  consumo: string;
  propina: string;
  total: string;
}

/**
 * HU-022 (BL-494): el comensal elige la propina antes de pagar.
 *
 * - Se guarda la ELECCIÓN en el pedido (porcentaje o monto libre), no el
 *   monto: el backend lo calcula sobre las líneas al cobrar (BL-90), así la
 *   tarjeta, el efectivo y el POS ven la misma propina.
 * - Es un PUT: reemplaza la elección anterior. Sin porcentaje ni monto, borra
 *   la elección (sin propina).
 * - Solo mientras el pedido espera el pago: si ya se pagó, se canceló o hay un
 *   pago con tarjeta en curso, cambiar la propina dejaría un cobro distinto
 *   del que se mostró (409).
 * - Tope del monto libre: el consumo, en pesos enteros (400).
 *
 * El acceso al pedido (QR y sesión de la mesa) ya lo validaron MesaQrGuard y
 * PedidoAccesoGuard (RD.05).
 */
@Injectable()
export class PropinaPedidoService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async elegir(
    tenantId: string,
    pedidoId: string,
    dto: ElegirPropinaDto,
  ): Promise<PropinaElegida> {
    const porcentaje = dto.porcentaje ?? null;
    const monto = dto.monto ?? null;
    if (porcentaje !== null && monto !== null) {
      throw new BadRequestException(
        'Elegí un porcentaje o un monto, no los dos',
      );
    }

    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const pedido = await tx.pedido.findUnique({
        where: { id: pedidoId },
        select: {
          estado: true,
          lineas: { select: { subtotal: true } },
          pagos: { where: { estado: 'PENDIENTE' }, select: { id: true } },
        },
      });
      if (!pedido) {
        throw new NotFoundException('Pedido no encontrado');
      }
      if (pedido.estado === 'CANCELADO') {
        throw new ConflictException('El pedido está cancelado');
      }
      if (pedido.estado !== 'PENDIENTE_PAGO') {
        throw new ConflictException('Este pedido ya fue pagado');
      }
      if (pedido.pagos.length > 0) {
        throw new ConflictException(
          'Ya hay un pago con tarjeta en curso: no se puede cambiar la propina.',
        );
      }

      const tope = topeDePropina(sumarConsumo(pedido.lineas));
      if (monto !== null && new Prisma.Decimal(monto).greaterThan(tope)) {
        throw new BadRequestException(
          `La propina no puede ser mayor al consumo ($ ${tope.toFixed(0)})`,
        );
      }

      const eleccion = { propinaPorcentaje: porcentaje, propinaMonto: monto };
      await tx.pedido.update({ where: { id: pedidoId }, data: eleccion });

      const totales = calcularTotales(pedido.lineas, eleccion);
      return {
        pedidoId,
        ...eleccion,
        consumo: totales.consumo.toFixed(2),
        propina: totales.propina.toFixed(2),
        total: totales.total.toFixed(2),
      };
    });
  }
}
