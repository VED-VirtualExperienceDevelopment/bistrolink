import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CrearPagoDto } from './dto/crear-pago.dto';
import { PagoGatewayFactory } from './gateways/pago-gateway.factory';

@Injectable()
export class PagosService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly gatewayFactory: PagoGatewayFactory,
  ) {}

  async crear(tenantId: string, dto: CrearPagoDto) {
    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      // Idempotencia (BL-90/BL-77): mismo idempotencyKey dos veces -> se
      // devuelve el pago ya existente, nunca se cobra dos veces.
      const existente = await tx.pago.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existente) {
        return existente;
      }

      const pedido = await tx.pedido.findUnique({
        where: { id: dto.pedidoId },
        include: { lineas: true, mesa: true },
      });
      if (!pedido) {
        throw new NotFoundException('Pedido no encontrado');
      }

      const yaHayPagoAprobado = await tx.pago.findFirst({
        where: { pedidoId: pedido.id, estado: 'APROBADO' },
      });
      if (yaHayPagoAprobado) {
        throw new ConflictException('Este pedido ya fue pagado');
      }

      // BL-90: el monto SIEMPRE se calcula acá, nunca se confía en lo que
      // mande el cliente (el DTO ni siquiera tiene un campo `monto`).
      const monto = pedido.lineas.reduce(
        (acumulado, linea) => acumulado.plus(linea.subtotal),
        new Prisma.Decimal(0),
      );
      if (monto.lessThanOrEqualTo(0)) {
        throw new BadRequestException('El pedido no tiene monto a cobrar');
      }

      // HU-017 (schema): acá es donde se dispara la transición real de la
      // mesa a EN_PROCESO_DE_PAGO.
      await tx.mesa.update({
        where: { id: pedido.mesaId },
        data: { estado: 'EN_PROCESO_DE_PAGO' },
      });

      const gateway = this.gatewayFactory.obtener(dto.medioPago);
      const resultado = await gateway.cobrar({
        monto,
        idempotencyKey: dto.idempotencyKey,
        pedidoId: pedido.id,
        tenantId,
        datosPasarela: dto.datosPasarela,
      });

      const pago = await tx.pago.create({
        data: {
          tenantId,
          pedidoId: pedido.id,
          idempotencyKey: dto.idempotencyKey,
          monto,
          medioPago: dto.medioPago,
          estado: resultado.pendiente
            ? 'PENDIENTE'
            : resultado.aprobado
              ? 'APROBADO'
              : 'RECHAZADO',
          pasarelaReferencia: resultado.pasarelaReferencia,
        },
      });

      // Pago simple (HU-007): un único pago cubre el total -> mesa libre.
      // HU-008 va a reemplazar este chequeo por una suma de pagos parciales.
      // Pendiente: el cobro está en vuelo, la mesa sigue EN_PROCESO_DE_PAGO.
      if (!resultado.pendiente) {
        await tx.mesa.update({
          where: { id: pedido.mesaId },
          data: { estado: resultado.aprobado ? 'LIBRE' : 'OCUPADA' },
        });
      }

      return pago;
    });
  }
}
