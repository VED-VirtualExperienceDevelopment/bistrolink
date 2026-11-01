import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CfeProveedor, Prisma, PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import {
  ActualizarConfiguracionDto,
  PROVEEDORES_CFE_DISPONIBLES,
} from './dto/actualizar-configuracion.dto';

/** HU-020 (BL-72): respuesta de GET y PATCH /admin/configuracion. */
export interface ConfiguracionEstablecimiento {
  /** Datos fiscales del emisor (tabla tenant). */
  razonSocial: string;
  /** Solo lectura para el Administrador: lo cambia la plataforma (BL-412). */
  rut: string;
  efectivoHabilitado: boolean;
  mercadoPagoHabilitado: boolean;
  plexoHabilitado: boolean;
  handyHabilitado: boolean;
  /** Porcentajes enteros, de menor a mayor. Vacío = sin sugerencias. */
  propinasSugeridas: number[];
  cfeProveedor: CfeProveedor;
  /** Los que se pueden elegir hoy (Biller quedó fuera del MVP). */
  proveedoresCfeDisponibles: CfeProveedor[];
}

/** Campos de la configuración que viven en restaurante. */
const SELECT_RESTAURANTE = {
  efectivoHabilitado: true,
  mercadoPagoHabilitado: true,
  plexoHabilitado: true,
  handyHabilitado: true,
  propinasSugeridas: true,
  cfeProveedor: true,
} satisfies Prisma.RestauranteSelect;

type ConfiguracionDelRestaurante = Prisma.RestauranteGetPayload<{
  select: typeof SELECT_RESTAURANTE;
}>;
type CampoDelRestaurante = keyof ConfiguracionDelRestaurante;
type CampoConfiguracion = keyof ActualizarConfiguracionDto;

const CAMPOS_DEL_RESTAURANTE = Object.keys(
  SELECT_RESTAURANTE,
) as CampoDelRestaurante[];

interface Actual {
  razonSocial: string;
  rut: string;
  restaurante: ConfiguracionDelRestaurante;
}

/** Lo que cambió, listo para escribir y auditar. */
interface Cambios {
  campos: CampoConfiguracion[];
  razonSocial?: string;
  restaurante: Prisma.RestauranteUpdateInput;
  antes: Record<string, unknown>;
  despues: Record<string, unknown>;
}

/** Igualdad de valores simples y de listas de números. */
function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * HU-020 (BL-72): configuración del establecimiento que maneja el
 * Administrador: razón social, medios de pago, propinas sugeridas y
 * proveedor de CFE.
 *
 * - Todo vive en filas que ya existen: la razón social y el RUT en tenant;
 *   el resto en restaurante (un tenant tiene un solo restaurante, BL-163).
 *   efectivoHabilitado es la columna de HU-031, la misma que consulta
 *   CobroEfectivoService.registrar (409 si está apagado).
 * - Solo se escribe lo que cambia de verdad (mandar el mismo valor no
 *   cuenta). Si no cambió nada, no se escribe ni se audita.
 * - Cambio y auditoría van en la misma transacción (registrarEnTx, HU-035):
 *   si una falla, no queda ninguna de las dos.
 * - Auditoría ESTABLECIMIENTO_CONFIGURACION_MODIFICADA con los campos que
 *   cambiaron y, para medios de pago, propinas y CFE, los valores antes y
 *   después. La razón social va sin el valor, mismo criterio que BL-412: en
 *   un unipersonal es el nombre de una persona.
 */
@Injectable()
export class ConfiguracionEstablecimientoService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async obtener(tenantId: string): Promise<ConfiguracionEstablecimiento> {
    const actual = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      this.leer(tx, tenantId),
    );
    return armarRespuesta(actual);
  }

  async actualizar(
    tenantId: string,
    dto: ActualizarConfiguracionDto,
    actor: { id: string },
  ): Promise<ConfiguracionEstablecimiento> {
    const pedidos = (Object.keys(dto) as CampoConfiguracion[]).filter(
      (campo) => dto[campo] !== undefined,
    );
    if (pedidos.length === 0) {
      throw new BadRequestException('No hay cambios');
    }

    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      const actual = await this.leer(tx, tenantId);
      const cambios = calcularCambios(actual, dto);
      if (cambios.campos.length === 0) {
        return armarRespuesta(actual);
      }

      if (cambios.razonSocial !== undefined) {
        await tx.tenant.update({
          where: { id: tenantId },
          data: { razonSocial: cambios.razonSocial },
        });
      }
      let restaurante = actual.restaurante;
      if (Object.keys(cambios.restaurante).length > 0) {
        restaurante = await tx.restaurante.update({
          where: { tenantId },
          data: cambios.restaurante,
          select: SELECT_RESTAURANTE,
        });
      }

      await this.auditLog.registrarEnTx(tx, {
        action: AuditAction.ESTABLECIMIENTO_CONFIGURACION_MODIFICADA,
        tenantId,
        actorKeycloakId: actor.id,
        entidadId: tenantId,
        detalle: { campos: cambios.campos },
        antes: cambios.antes,
        despues: cambios.despues,
      });

      return armarRespuesta({
        razonSocial: cambios.razonSocial ?? actual.razonSocial,
        rut: actual.rut,
        restaurante,
      });
    });
  }

  /** Tenant y restaurante actuales. Sin restaurante (alta incompleta): 409. */
  private async leer(tx: PrismaClient, tenantId: string): Promise<Actual> {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { razonSocial: true, rut: true },
    });
    if (!tenant) {
      throw new NotFoundException('No existe un establecimiento con ese id');
    }
    const restaurante = await tx.restaurante.findUnique({
      where: { tenantId },
      select: SELECT_RESTAURANTE,
    });
    if (!restaurante) {
      throw new ConflictException(
        'El establecimiento todavía no tiene restaurante: hay que completar el alta antes de configurarlo',
      );
    }
    return { ...tenant, restaurante };
  }
}

/** Compara lo pedido con lo actual y arma la escritura y el diff. */
function calcularCambios(
  actual: Actual,
  dto: ActualizarConfiguracionDto,
): Cambios {
  const cambios: Cambios = {
    campos: [],
    restaurante: {},
    antes: {},
    despues: {},
  };

  if (dto.razonSocial !== undefined && dto.razonSocial !== actual.razonSocial) {
    cambios.campos.push('razonSocial');
    cambios.razonSocial = dto.razonSocial;
  }

  for (const campo of CAMPOS_DEL_RESTAURANTE) {
    const nuevo = dto[campo];
    const anterior = actual.restaurante[campo];
    if (nuevo === undefined || igual(nuevo, anterior)) continue;
    cambios.campos.push(campo);
    (cambios.restaurante as Record<string, unknown>)[campo] = nuevo;
    cambios.antes[campo] = anterior;
    cambios.despues[campo] = nuevo;
  }
  return cambios;
}

function armarRespuesta(actual: Actual): ConfiguracionEstablecimiento {
  return {
    razonSocial: actual.razonSocial,
    rut: actual.rut,
    ...actual.restaurante,
    proveedoresCfeDisponibles: [...PROVEEDORES_CFE_DISPONIBLES],
  };
}
