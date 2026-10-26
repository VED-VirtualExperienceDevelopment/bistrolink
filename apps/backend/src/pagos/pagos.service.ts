import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PagoEstado, PedidoEstado, Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SolicitudPago } from './dto/crear-pago.dto';
import { PagoGatewayFactory } from './gateways/pago-gateway.factory';
import { ResultadoCobro } from './gateways/pago-gateway.interface';
import { PagoRechazadoException } from './gateways/pago-rechazado.exception';
import { PagoTemporalmenteNoDisponibleException } from './gateways/pago-temporalmente-no-disponible.exception';
import { CfeService, ResumenComprobante } from '../cfe/cfe.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { PedidoParaKds } from '../pedidos/pedido-kds.mapper';

/** BL-311: respuesta de GET /pedidos/:pedidoId/pagos. */
export interface EstadoPagoDelPedido {
  pedidoId: string;
  estadoPedido: PedidoEstado;
  pago: {
    id: string;
    estado: PagoEstado;
    medioPago: string;
    monto: string;
  } | null;
  // Null mientras el CFE no fue emitido (el frontend consulta de nuevo).
  comprobante: ResumenComprobante | null;
}

// El pago que importa para el comensal: el que cobró (aprobado o después
// reembolsado). Si no hay ninguno, el último intento (pendiente o rechazado).
const ESTADOS_COBRADOS: ReadonlySet<PagoEstado> = new Set<PagoEstado>([
  'APROBADO',
  'REEMBOLSADO',
]);

@Injectable()
export class PagosService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly gatewayFactory: PagoGatewayFactory,
    private readonly cfe: CfeService,
    private readonly pedidos: PedidosService,
  ) {}

  // BL-311: el pedidoId lo pone el controller desde la ruta.
  async crear(tenantId: string, dto: SolicitudPago) {
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

    const { pagoFinal, pedidoConfirmado } =
      await this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
        // Solo si el pago sigue PENDIENTE: el webhook de Mercado Pago puede
        // haberlo resuelto antes de que llegue la respuesta de esta llamada,
        // y una respuesta más vieja no debe pisar el estado real.
        const { count } = await tx.pago.updateMany({
          where: { id: pago.id, estado: 'PENDIENTE' },
          data: { estado, pasarelaReferencia: resultado.pasarelaReferencia },
        });
        let confirmado: PedidoParaKds | null = null;
        if (count > 0 && !resultado.pendiente) {
          // BL-311: aprobado o rechazado, la mesa vuelve a OCUPADA. Con
          // prepago, el comensal paga ANTES de comer: la mesa la libera el
          // cierre de sesión (HU-017), no el pago.
          await tx.mesa.updateMany({
            where: { id: mesaId, estado: 'EN_PROCESO_DE_PAGO' },
            data: { estado: 'OCUPADA' },
          });
          // BL-311 (RD.03): pago aprobado => el pedido pasa a RECIBIDO.
          if (resultado.aprobado) {
            confirmado = await this.pedidos.confirmarPagoEnTx(
              tx,
              tenantId,
              pago.pedidoId,
            );
          }
        }
        return {
          pagoFinal: await tx.pago.findUniqueOrThrow({
            where: { id: pago.id },
          }),
          pedidoConfirmado: confirmado,
        };
      });

    // Recién con la transacción confirmada se avisa a cocina y al comensal.
    if (pedidoConfirmado) {
      this.pedidos.notificarPedidoConfirmado(tenantId, pedidoConfirmado);
    }

    // BL-77: ya guardado como RECHAZADO; recién ahora se le avisa al comensal.
    if (pagoFinal.estado === 'RECHAZADO') {
      throw new PagoRechazadoException(resultado.motivoRechazo);
    }

    // Pago aprobado: el eTicket se emite en segundo plano, para responder
    // al comensal sin esperar a Surtec (puede tardar varios segundos). La
    // pantalla de pago aprobado consulta GET /pedidos/:id/pagos hasta que
    // aparece. Si Surtec falla, el cobro no se pierde (ver CfeService).
    if (pagoFinal.estado === 'APROBADO') {
      this.cfe.emitirEnSegundoPlano(tenantId, pagoFinal.id);
      return pagoFinal;
    }

    // Checkout embebido (Plexo): esto nunca se persiste — es una URL de un
    // solo uso que el frontend necesita YA, no un dato del Pago en sí.
    if (resultado.accionRequerida) {
      return { ...pagoFinal, accionRequerida: resultado.accionRequerida };
    }
    return pagoFinal;
  }

  /**
   * BL-311: estado del pago del pedido y su comprobante, para la pantalla
   * del comensal. El acceso ya lo validó PedidoAccesoGuard (RD.05); acá se
   * consulta igual dentro del tenant (RLS).
   *
   * Solo lectura: no reintenta la emisión del CFE. Si el pago está APROBADO
   * y el comprobante no llega, lo resuelve la conciliación (HU-023, BL-96).
   */
  async consultar(
    tenantId: string,
    pedidoId: string,
  ): Promise<EstadoPagoDelPedido> {
    const pedido = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.pedido.findUnique({
        where: { id: pedidoId },
        select: {
          id: true,
          estado: true,
          pagos: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              estado: true,
              medioPago: true,
              monto: true,
              comprobantes: {
                orderBy: { createdAt: 'asc' },
                take: 1,
                select: { serie: true, numero: true, urlConsulta: true },
              },
            },
          },
        },
      }),
    );
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    const pago =
      pedido.pagos.find((p) => ESTADOS_COBRADOS.has(p.estado)) ??
      pedido.pagos[0] ??
      null;
    const comprobante = pago?.comprobantes[0] ?? null;

    return {
      pedidoId: pedido.id,
      estadoPedido: pedido.estado,
      pago: pago && {
        id: pago.id,
        estado: pago.estado,
        medioPago: pago.medioPago,
        monto: pago.monto.toFixed(2),
      },
      comprobante: comprobante && {
        serie: comprobante.serie,
        numero: comprobante.numero,
        urlConsulta: comprobante.urlConsulta,
      },
    };
  }

  private async reservar(tenantId: string, dto: SolicitudPago) {
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
