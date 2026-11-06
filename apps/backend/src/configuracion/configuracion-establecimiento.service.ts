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
import { KdsGateway } from '../pedidos/kds.gateway';
import { completarCapacidad, type PedidoPromovido } from '../pedidos/cola-kds';
import {
  ActualizarConfiguracionDto,
  MEDIOS_PAGO_DISPONIBLES,
  MedioPagoConfigurable,
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
  /** Los que se pueden habilitar hoy (Plexo y Handy quedaron fuera del MVP). */
  mediosPagoDisponibles: MedioPagoConfigurable[];
  /** Porcentajes enteros, de menor a mayor. Vacío = sin sugerencias. */
  propinasSugeridas: number[];
  cfeProveedor: CfeProveedor;
  /** Los que se pueden elegir hoy (Biller quedó fuera del MVP). */
  proveedoresCfeDisponibles: CfeProveedor[];
  /** HU-036 (BL-206): contacto para los derechos de los titulares de datos. */
  emailPrivacidad: string | null;
  /** HU-042 (BL-465): null = cola automática del KDS desactivada. */
  limitePedidosEnPreparacion: number | null;
  /** HU-042 (BL-465): con más pedidos en espera, alerta de alta demanda. */
  umbralAlertaCola: number;
  /** HU-042 (BL-465): referencia para el tiempo estimado del comensal. */
  minutosPreparacionEstimados: number;
}

/** Campos de la configuración que viven en restaurante. */
const SELECT_RESTAURANTE = {
  efectivoHabilitado: true,
  mercadoPagoHabilitado: true,
  plexoHabilitado: true,
  handyHabilitado: true,
  propinasSugeridas: true,
  cfeProveedor: true,
  emailPrivacidad: true,
  // HU-042 (BL-465): cola del KDS. Van con antes y después a la auditoría.
  limitePedidosEnPreparacion: true,
  umbralAlertaCola: true,
  minutosPreparacionEstimados: true,
} satisfies Prisma.RestauranteSelect;

/** HU-042 (BL-465): campos que cambian el estado de la cola del KDS. */
const CAMPOS_DE_LA_COLA: ReadonlySet<CampoConfiguracion> = new Set([
  'limitePedidosEnPreparacion',
  'umbralAlertaCola',
  'minutosPreparacionEstimados',
]);

type ConfiguracionDelRestaurante = Prisma.RestauranteGetPayload<{
  select: typeof SELECT_RESTAURANTE;
}>;
type CampoDelRestaurante = keyof ConfiguracionDelRestaurante;
type CampoConfiguracion = keyof ActualizarConfiguracionDto;

/**
 * Campos cuyo valor no va a la auditoría (solo que cambiaron): mismo criterio
 * que la razón social. El correo de privacidad (HU-036) puede ser el de una
 * persona.
 */
const SIN_VALOR_EN_AUDITORIA: ReadonlySet<CampoDelRestaurante> = new Set([
  'emailPrivacidad',
]);

const CAMPOS_DEL_RESTAURANTE = Object.keys(
  SELECT_RESTAURANTE,
) as CampoDelRestaurante[];

interface Actual {
  razonSocial: string;
  rut: string;
  restaurante: ConfiguracionDelRestaurante;
}

/** HU-042 (BL-465): lo que devuelve la transacción de actualizar. */
interface ResultadoActualizacion {
  configuracion: ConfiguracionEstablecimiento;
  /** Cambió algún campo de la cola: hay que avisar al KDS. */
  cambioLaCola: boolean;
  /** Pedidos que pasaron a preparación al subir el límite. */
  promovidos: PedidoPromovido[];
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
    // HU-042 (BL-465): avisar al KDS cuando cambia la configuración de la cola.
    private readonly kdsGateway: KdsGateway,
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

    const resultado = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx): Promise<ResultadoActualizacion> => {
        const actual = await this.leer(tx, tenantId);
        const cambios = calcularCambios(actual, dto);
        if (cambios.campos.length === 0) {
          return {
            configuracion: armarRespuesta(actual),
            cambioLaCola: false,
            promovidos: [],
          };
        }
        return this.guardarCambios(tx, tenantId, actor, actual, cambios);
      },
    );

    // HU-042 (BL-465): después del commit, como el resto de los avisos en
    // vivo. Los pedidos que pasaron a preparación (subió el límite o se
    // activó la cola) y el estado nuevo de la cola, también si se desactivó.
    if (resultado.cambioLaCola) {
      for (const promovido of resultado.promovidos) {
        this.kdsGateway.emitirPedidoActualizado(tenantId, promovido);
      }
      await this.kdsGateway.avisarEstadoCola(tenantId, { forzar: true });
    }
    return resultado.configuracion;
  }

  /** Escribe los cambios, los audita y, si hace falta, llena la cocina. */
  private async guardarCambios(
    tx: PrismaClient,
    tenantId: string,
    actor: { id: string },
    actual: Actual,
    cambios: Cambios,
  ): Promise<ResultadoActualizacion> {
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

    // HU-042 (BL-465): si cambió el límite (subió o se activó la cola), los
    // lugares libres se llenan con la cola en esta misma transacción. Si
    // bajó, no se saca a nadie de preparación: la cola espera hasta que la
    // cocina quede por debajo del límite nuevo.
    const promovidos = cambios.campos.includes('limitePedidosEnPreparacion')
      ? await completarCapacidad(tx, tenantId)
      : [];

    return {
      configuracion: armarRespuesta({
        razonSocial: cambios.razonSocial ?? actual.razonSocial,
        rut: actual.rut,
        restaurante,
      }),
      cambioLaCola: cambios.campos.some((campo) =>
        CAMPOS_DE_LA_COLA.has(campo),
      ),
      promovidos,
    };
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
    if (SIN_VALOR_EN_AUDITORIA.has(campo)) continue;
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
    mediosPagoDisponibles: [...MEDIOS_PAGO_DISPONIBLES],
    proveedoresCfeDisponibles: [...PROVEEDORES_CFE_DISPONIBLES],
  };
}
