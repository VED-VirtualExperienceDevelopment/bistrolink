import { Injectable, NotFoundException } from '@nestjs/common';
import { PedidoEstado } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import {
  EstadoEstablecimiento,
  estadoDelEstablecimiento,
} from './establecimientos.service';
import { tieneActividad } from './eliminacion-establecimiento.service';

/** BL-411: días que abarca el conteo de pedidos del resumen. */
export const DIAS_RESUMEN_PEDIDOS = 30;
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * BL-413: pedidos que todavía no terminaron (ni entregados ni cancelados).
 * La ficha los cuenta para avisar antes de suspender: suspender no los
 * cancela, pero el restaurante ya no los puede mover.
 */
export const ESTADOS_PEDIDO_ABIERTO: PedidoEstado[] = [
  'RECIBIDO',
  'EN_PREPARACION',
  'LISTO_PARA_ENTREGAR',
];

/**
 * BL-411: una cuenta del establecimiento, como la ve la plataforma. Sin
 * contraseñas, email ni ids: lo necesario para saber quién es y si entra.
 * Los Administradores suman el id de su fila (AdministradorFicha, BL-414).
 *
 * `ultimoIngreso`: ISO, `null` si no ingresó en los últimos 90 días, o
 * ausente si Keycloak no pudo dar el dato (mismo criterio que Usuarios,
 * BL-368).
 */
export interface CuentaFicha {
  username: string | null;
  nombre: string | null;
  apellido: string | null;
  activo: boolean;
  ultimoIngreso?: string | null;
}

/**
 * BL-414: un Administrador en la ficha. Suma el id de su fila en `usuario`,
 * que la plataforma necesita para restablecerle la contraseña. Sigue sin
 * email ni id de Keycloak.
 */
export interface AdministradorFicha extends CuentaFicha {
  id: string;
}

export interface FichaEstablecimiento {
  tenantId: string;
  razonSocial: string;
  rut: string;
  plan: string;
  creadoPor: string | null;
  creadoEl: Date;
  /** Mismo estado que el listado (BL-410). */
  estado: EstadoEstablecimiento;
  /** null mientras el alta no terminó. */
  altaCompletadaEn: Date | null;
  /** Solo si está suspendido. */
  suspension: { desde: Date | null; motivo: string | null } | null;
  restaurante: {
    id: string;
    nombre: string;
    direccion: string;
    timezone: string;
  } | null;
  administradores: AdministradorFicha[];
  /** La cuenta compartida de Cocina (solo Keycloak); normalmente una. */
  cocina: CuentaFicha[];
  /** null si el tenant todavía no tiene restaurante. */
  resumen: {
    mesas: number;
    itemsCarta: number;
    pedidosRecientes: number;
    diasPedidos: number;
    /** BL-413: pedidos sin terminar (ESTADOS_PEDIDO_ABIERTO). */
    pedidosAbiertos: number;
  } | null;
  /**
   * BL-418: si se puede eliminar (no tiene ningún pedido). Si no, la única
   * opción es suspenderlo. El DELETE lo vuelve a controlar.
   */
  eliminable: boolean;
}

interface CuentaListada {
  /** Fila de `usuario` (personal) o id de Keycloak (Cocina). */
  id: string;
  rol: string;
  cuentaCompartida: boolean;
  username: string | null;
  nombre: string | null;
  apellido: string | null;
  activo: boolean;
  ultimoIngreso?: string | null;
}

/**
 * BL-411: arma una cuenta para la ficha. `ultimoIngreso` se copia solo si
 * vino: ausente quiere decir «no se sabe», distinto de null («sin ingresos
 * recientes»).
 *
 * No usa el id: los Administradores lo suman aparte (BL-414) y la cuenta de
 * Cocina no lo lleva.
 */
export function cuentaParaFicha(
  cuenta: Omit<CuentaListada, 'id'>,
): CuentaFicha {
  return {
    username: cuenta.username,
    nombre: cuenta.nombre,
    apellido: cuenta.apellido,
    activo: cuenta.activo,
    ...('ultimoIngreso' in cuenta
      ? { ultimoIngreso: cuenta.ultimoIngreso }
      : {}),
  };
}

/**
 * BL-411: ficha de un establecimiento para el rol PLATAFORMA.
 *
 * - `tenant`, `restaurante` y los conteos se leen en una transacción dentro
 *   del contexto de ESE tenant (RLS), igual que el listado. Los conteos
 *   también filtran por tenant_id, por si acaso.
 * - Administradores y Cocina salen de UsuariosService.listar, el mismo que
 *   usa la pantalla de Usuarios del restaurante: personal de la tabla
 *   `usuario`, cuenta de Cocina desde Keycloak y último ingreso con una sola
 *   búsqueda de eventos. Si Keycloak no responde, la ficha sale igual, sin
 *   Cocina o sin último ingreso.
 * - El comensal técnico y los Mozos no se muestran. Nada de comensales.
 */
@Injectable()
export class FichaEstablecimientoService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly usuarios: UsuariosService,
  ) {}

  async obtener(
    tenantId: string,
    ahora: Date = new Date(),
  ): Promise<FichaEstablecimiento> {
    const desde = new Date(ahora.getTime() - DIAS_RESUMEN_PEDIDOS * DIA_MS);

    const datos = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: {
            razonSocial: true,
            rut: true,
            plan: true,
            creadoPor: true,
            createdAt: true,
            estado: true,
            suspendidoEn: true,
            motivoSuspension: true,
            altaCompletadaEn: true,
          },
        });
        if (!tenant) return null;

        const restaurante = await tx.restaurante.findUnique({
          where: { tenantId },
          select: { id: true, nombre: true, direccion: true, timezone: true },
        });
        const resumen = restaurante
          ? {
              // La mesa virtual (HU-003) no es una mesa del salón.
              mesas: await tx.mesa.count({
                where: { tenantId, esVirtual: false },
              }),
              itemsCarta: await tx.itemCarta.count({ where: { tenantId } }),
              pedidosRecientes: await tx.pedido.count({
                where: { tenantId, createdAt: { gte: desde } },
              }),
              diasPedidos: DIAS_RESUMEN_PEDIDOS,
              pedidosAbiertos: await tx.pedido.count({
                where: { tenantId, estado: { in: ESTADOS_PEDIDO_ABIERTO } },
              }),
            }
          : null;
        const eliminable = !(await tieneActividad(tx, tenantId));
        return { tenant, restaurante, resumen, eliminable };
      },
    );

    if (!datos) {
      throw new NotFoundException('No existe un establecimiento con ese id');
    }
    const { tenant, restaurante, resumen, eliminable } = datos;

    const cuentas: CuentaListada[] = await this.usuarios.listar(tenantId);
    const porUsername = (a: CuentaFicha, b: CuentaFicha) =>
      (a.username ?? '').localeCompare(b.username ?? '');

    return {
      tenantId,
      razonSocial: tenant.razonSocial,
      rut: tenant.rut,
      plan: tenant.plan,
      creadoPor: tenant.creadoPor,
      creadoEl: tenant.createdAt,
      estado: estadoDelEstablecimiento(tenant),
      altaCompletadaEn: tenant.altaCompletadaEn,
      suspension:
        tenant.estado === 'SUSPENDIDO'
          ? { desde: tenant.suspendidoEn, motivo: tenant.motivoSuspension }
          : null,
      restaurante,
      administradores: cuentas
        .filter((c) => c.rol === 'ADMIN' && !c.cuentaCompartida)
        .map((c) => ({ ...cuentaParaFicha(c), id: c.id }))
        .sort(porUsername),
      cocina: cuentas
        .filter((c) => c.cuentaCompartida)
        .map(cuentaParaFicha)
        .sort(porUsername),
      resumen,
      eliminable,
    };
  }
}
