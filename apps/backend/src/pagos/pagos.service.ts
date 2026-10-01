import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CrearPagoDto } from './dto/crear-pago.dto';
import { PagoGatewayFactory } from './gateways/pago-gateway.factory';
import { ResultadoCobro } from './gateways/pago-gateway.interface';
import { PagoRechazadoException } from './gateways/pago-rechazado.exception';
import { PagoTemporalmenteNoDisponibleException } from './gateways/pago-temporalmente-no-disponible.exception';

@Injectable()
export class PagosService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly gatewayFactory: PagoGatewayFactory,
  ) {}

  async crear(tenantId: string, dto: CrearPagoDto) {
    // Primero se elige la pasarela: si el medio de pago no está disponible,
    // se falla ACÁ, antes de reservar el pago o tocar la mesa.
    const gateway = this.gatewayFactory.obtener(dto.medioPago);

    // Fase 1: validar, calcular el monto en el backend (BL-90) y reservar
    // el pago como PENDIENTE. Transacción corta, sin red de por medio.
    const reserva = await this.reservar(tenantId, dto);
    if ('existente' in reserva) {
      return reserva.existente; // idempotencia: misma clave, mismo pago
    }
    const { pago, mesaId } = reserva;

    // Fase 2: cobrar FUERA de la transacción (la pasarela puede tardar).
    let resultado: ResultadoCobro;
    try {
      resultado = await gateway.cobrar({
        monto: pago.monto,
        idempotencyKey: dto.idempotencyKey,
        pedidoId: dto.pedidoId,
        tenantId,
        datosPasarela: dto.datosPasarela,
      });
    } catch (error) {
      // Modo degradado (BL-77): no sabemos si la pasarela llegó a cobrar.
      // El pago queda PENDIENTE y la mesa EN_PROCESO_DE_PAGO, para
      // reconciliar después. Ya está guardado (la Fase 1 se confirmó).
      if (error instanceof PagoTemporalmenteNoDisponibleException) {
        throw error;
      }
      // La pasarela respondió con un error: no hubo cobro.
      if (error instanceof HttpException) {
        await this.cerrarRechazado(tenantId, pago.id, mesaId);
      }
      throw error;
    }

    // Fase 3: guardar el resultado.
    let estado: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
    if (resultado.pendiente) {
      estado = 'PENDIENTE';
    } else if (resultado.aprobado) {
      estado = 'APROBADO';
    } else {
      estado = 'RECHAZADO';
    }

    const pagoFinal = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        // Solo si el pago sigue PENDIENTE: el webhook de Mercado Pago puede
        // haberlo resuelto antes de que llegue la respuesta de esta llamada,
        // y una respuesta más vieja no debe pisar el estado real.
        const { count } = await tx.pago.updateMany({
          where: { id: pago.id, estado: 'PENDIENTE' },
          data: { estado, pasarelaReferencia: resultado.pasarelaReferencia },
        });
        if (count > 0 && !resultado.pendiente) {
          // Pago simple (HU-007): un único pago cubre el total. HU-008 lo
          // reemplaza por la suma de pagos parciales.
          await tx.mesa.updateMany({
            where: { id: mesaId, estado: 'EN_PROCESO_DE_PAGO' },
            data: { estado: resultado.aprobado ? 'LIBRE' : 'OCUPADA' },
          });
        }
        return tx.pago.findUniqueOrThrow({ where: { id: pago.id } });
      },
    );

    // BL-77: ya guardado como RECHAZADO; recién ahora se le avisa al comensal.
    if (pagoFinal.estado === 'RECHAZADO') {
      throw new PagoRechazadoException(resultado.motivoRechazo);
    }

    // Checkout embebido (Plexo): esto nunca se persiste — es una URL de un
    // solo uso que el frontend necesita YA, no un dato del Pago en sí.
    if (resultado.accionRequerida) {
      return { ...pagoFinal, accionRequerida: resultado.accionRequerida };
    }
    return pagoFinal;
  }

  private async reservar(tenantId: string, dto: CrearPagoDto) {
    try {
      return await this.tenantPrisma.runInTenantContext(
        tenantId,
        async (tx) => {
          const existente = await tx.pago.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
          });
          if (existente) {
            return { existente };
          }

          const pedido = await tx.pedido.findUnique({
            where: { id: dto.pedidoId },
            include: { lineas: true },
          });
          if (!pedido) {
            throw new NotFoundException('Pedido no encontrado');
          }

          const otro = await tx.pago.findFirst({
            where: {
              pedidoId: pedido.id,
              estado: { in: ['APROBADO', 'PENDIENTE'] },
            },
          });
          if (otro?.estado === 'APROBADO') {
            throw new ConflictException('Este pedido ya fue pagado');
          }
          if (otro) {
            throw new ConflictException(
              'Ya hay un pago en curso para este pedido',
            );
          }

          const monto = pedido.lineas.reduce(
            (acumulado, linea) => acumulado.plus(linea.subtotal),
            new Prisma.Decimal(0),
          );
          if (monto.lessThanOrEqualTo(0)) {
            throw new BadRequestException('El pedido no tiene monto a cobrar');
          }

          await tx.mesa.update({
            where: { id: pedido.mesaId },
            data: { estado: 'EN_PROCESO_DE_PAGO' },
          });
          const pago = await tx.pago.create({
            data: {
              tenantId,
              pedidoId: pedido.id,
              idempotencyKey: dto.idempotencyKey,
              monto,
              medioPago: dto.medioPago,
              estado: 'PENDIENTE',
            },
          });
          return { pago, mesaId: pedido.mesaId };
        },
      );
    } catch (error) {
      // Dos requests simultáneos con la misma clave: el segundo choca con
      // la clave única y devuelve el pago del primero, sin cobrar dos veces.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existente = await this.tenantPrisma.runInTenantContext(
          tenantId,
          (tx) =>
            tx.pago.findUnique({
              where: { idempotencyKey: dto.idempotencyKey },
            }),
        );
        if (existente) {
          return { existente };
        }
      }
      throw error;
    }
  }

  private async cerrarRechazado(
    tenantId: string,
    pagoId: string,
    mesaId: string,
  ) {
    await this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const { count } = await tx.pago.updateMany({
        where: { id: pagoId, estado: 'PENDIENTE' },
        data: { estado: 'RECHAZADO' },
      });
      if (count > 0) {
        await tx.mesa.updateMany({
          where: { id: mesaId, estado: 'EN_PROCESO_DE_PAGO' },
          data: { estado: 'OCUPADA' },
        });
      }
    });
  }
}
