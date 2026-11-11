import { Injectable } from '@nestjs/common';
import { PedidoEstado } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { MesaDelQr } from '../qr-mesa/qr-mesa-acceso.service';
import { sumarConsumo } from '../pagos/totales-pedido';
import { MARGEN_RELOJ_SESION_MS } from './pedido-acceso.guard';

/** BL-502: un pedido de «Mis pedidos», sin datos de pago ni del CFE. */
export interface PedidoDeLaMesa {
  id: string;
  estado: PedidoEstado;
  creadoEn: string;
  actualizadoEn: string;
  lineas: { nombre: string; cantidad: number }[];
  /** Suma de las líneas, con dos decimales ("590.00"). */
  consumo: string;
  /** Propina elegida (0 si no eligió). */
  propina: number;
}

/**
 * BL-502: «Mis pedidos» del comensal en la mesa.
 *
 * El navegador recuerda los ids de los pedidos que hizo desde ese
 * dispositivo; acá se devuelven solo los que son de la mesa del QR y de la
 * sesión abierta (HU-006, RD.05: nunca los de otro grupo ni los de otra
 * mesa). Un id que no cumple se omite sin decir por qué.
 */
@Injectable()
export class PedidosDeLaMesaService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async estado(
    mesa: MesaDelQr,
    ids: readonly string[],
  ): Promise<PedidoDeLaMesa[]> {
    if (ids.length === 0) return [];

    const desde = mesa.sesionAbiertaEn
      ? new Date(mesa.sesionAbiertaEn.getTime() - MARGEN_RELOJ_SESION_MS)
      : undefined;

    const pedidos = await this.tenantPrisma.runInTenantContext(
      mesa.tenantId,
      (tx) =>
        tx.pedido.findMany({
          where: {
            id: { in: [...ids] },
            mesaId: mesa.mesaId,
            canal: 'QR',
            ...(desde ? { createdAt: { gte: desde } } : {}),
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            estado: true,
            createdAt: true,
            updatedAt: true,
            propinaMonto: true,
            lineas: {
              orderBy: { createdAt: 'asc' },
              select: { nombreSnapshot: true, cantidad: true, subtotal: true },
            },
          },
        }),
    );

    return pedidos.map((pedido) => ({
      id: pedido.id,
      estado: pedido.estado,
      creadoEn: pedido.createdAt.toISOString(),
      actualizadoEn: pedido.updatedAt.toISOString(),
      lineas: pedido.lineas.map((l) => ({
        nombre: l.nombreSnapshot,
        cantidad: l.cantidad,
      })),
      consumo: sumarConsumo(pedido.lineas).toFixed(2),
      propina: pedido.propinaMonto ?? 0,
    }));
  }
}
