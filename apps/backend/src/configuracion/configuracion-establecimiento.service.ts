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
import { StorageService } from '../menu/storage.service';
import { completarCapacidad, type PedidoPromovido } from '../pedidos/cola-kds';
import {
  errorOrdenUmbrales,
  umbralesDelRestaurante,
  type FilaUmbralesEspera,
  type UmbralesEspera,
} from '../pedidos/umbrales-espera';
import {
  ActualizarConfiguracionDto,
  MEDIOS_PAGO_DISPONIBLES,
  MedioPagoConfigurable,
  PROVEEDORES_CFE_DISPONIBLES,
} from './dto/actualizar-configuracion.dto';
import { PLANTILLAS_MARCA, type PlantillaMarca } from './plantillas-marca';

/** HU-020 (BL-72): respuesta de GET y PATCH /admin/configuracion. */
export interface ConfiguracionEstablecimiento {
  /** Datos fiscales del emisor (tabla tenant). */
  razonSocial: string;
  /** Solo lectura para el Administrador: lo cambia la plataforma (BL-412). */
  rut: string;
  /** HU-043 (BL-561): nombre y dirección del local que ve el comensal. */
  nombre: string;
  direccion: string;
  efectivoHabilitado: boolean;
  mercadoPagoHabilitado: boolean;
  /** HU-007b (BL-80): cobros con el POS del local. */
  posHabilitado: boolean;
  plexoHabilitado: boolean;
  handyHabilitado: boolean;
  /** Los que se pueden habilitar hoy (Plexo y Handy quedaron fuera del MVP). */
  mediosPagoDisponibles: MedioPagoConfigurable[];
  /** Porcentajes enteros, de menor a mayor. Vacío = sin sugerencias. */
  propinasSugeridas: number[];
  /** HU-022 (BL-495): el pago del comensal abre con el 10 % marcado. */
  propinaPreseleccionada: boolean;
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
  /** HU-038 (BL-506): desde cuántos minutos la comanda pasa a «Atención». */
  minutosEsperaAtencion: number;
  /** HU-038 (BL-506): desde cuántos minutos pasa a «Demorado». */
  minutosEsperaDemorado: number;
  /** HU-038 (BL-506): desde cuántos minutos pasa a «Demora alta». */
  minutosEsperaDemoraAlta: number;
  /** HU-043 (BL-531): plantilla de colores de la carta del comensal. */
  plantilla: PlantillaMarca;
  /** HU-043 (BL-531): las que se pueden elegir. */
  plantillasDisponibles: PlantillaMarca[];
  /**
   * HU-043 (BL-532): URL firmada del logo, para mostrarlo en la pantalla.
   * null si no tiene logo. La key no se devuelve: para cambiarlo se manda la
   * key nueva que devolvió la confirmación de la imagen.
   */
  logoUrl: string | null;
  /** HU-040 (BL-210): pedidos para retirar por el enlace web. */
  retiroHabilitado: boolean;
  /** HU-040 (BL-210): franja diaria HH:MM; las dos null = todo el día. */
  retiroHoraDesde: string | null;
  retiroHoraHasta: string | null;
  /**
   * HU-043 (BL-562): URL firmada de la portada del banner, para la vista
   * previa. null = la portada por defecto. La key no se devuelve.
   */
  portadaUrl: string | null;
}

/** Campos de la configuración que viven en restaurante. */
const SELECT_RESTAURANTE = {
  // HU-043 (BL-561): nombre y dirección del local, con antes y después en
  // la auditoría (son públicos: salen en la carta).
  nombre: true,
  direccion: true,
  efectivoHabilitado: true,
  mercadoPagoHabilitado: true,
  posHabilitado: true,
  plexoHabilitado: true,
  handyHabilitado: true,
  propinasSugeridas: true,
  propinaPreseleccionada: true,
  cfeProveedor: true,
  emailPrivacidad: true,
  // HU-042 (BL-465): cola del KDS. Van con antes y después a la auditoría.
  limitePedidosEnPreparacion: true,
  umbralAlertaCola: true,
  minutosPreparacionEstimados: true,
  // HU-038 (BL-506): umbrales de espera de las comandas del KDS. También
  // van con antes y después a la auditoría.
  minutosEsperaAtencion: true,
  minutosEsperaDemorado: true,
  minutosEsperaDemoraAlta: true,
  // HU-043 (BL-531 y BL-532): plantilla y logo de marca, con antes y
  // después en la auditoría. El logo se responde como URL (logoUrl).
  plantilla: true,
  logoKey: true,
  // HU-040 (BL-210): pedidos para retirar.
  retiroHabilitado: true,
  retiroHoraDesde: true,
  retiroHoraHasta: true,
  // HU-043 (BL-562): portada del banner, igual que el logo.
  portadaKey: true,
} satisfies Prisma.RestauranteSelect;

/** HU-042 (BL-465): campos que cambian el estado de la cola del KDS. */
const CAMPOS_DE_LA_COLA: ReadonlySet<CampoConfiguracion> = new Set([
  'limitePedidosEnPreparacion',
  'umbralAlertaCola',
  'minutosPreparacionEstimados',
]);

/** HU-038 (BL-506): campos de los umbrales de espera del KDS. */
const CAMPOS_DE_ESPERA = [
  'minutosEsperaAtencion',
  'minutosEsperaDemorado',
  'minutosEsperaDemoraAlta',
] as const satisfies readonly CampoConfiguracion[];

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
  /** Lo que quedó guardado. La respuesta se arma después del commit. */
  guardado: Actual;
  /** Cambió algún campo de la cola: hay que avisar al KDS. */
  cambioLaCola: boolean;
  /** Pedidos que pasaron a preparación al subir el límite. */
  promovidos: PedidoPromovido[];
  /**
   * HU-038 (BL-506): umbrales nuevos, si cambió alguno (hay que avisar al
   * KDS). null si no cambiaron.
   */
  umbralesEspera: UmbralesEspera | null;
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
 * - HU-038 (BL-506): los umbrales de espera del KDS tienen que quedar de
 *   menor a mayor (400 si no); al cambiarlos se avisa a los KDS abiertos.
 * - HU-043 (BL-531): la plantilla de marca se elige de una lista cerrada
 *   (400 si no); los colores viven en el frontend.
 * - HU-043 (BL-532): el logo tiene que ser un logo publicado de este
 *   establecimiento (400 si no). Se responde como URL firmada.
 * - HU-043 (BL-561): el nombre y la dirección del local también los cambia
 *   el Administrador (antes, solo Plataforma). El RUT sigue siendo de
 *   Plataforma.
 * - Auditoría ESTABLECIMIENTO_CONFIGURACION_MODIFICADA con los campos que
 *   cambiaron y, para medios de pago, propinas, CFE y plantilla, los
 *   valores antes y después. La razón social va sin el valor, mismo
 *   criterio que BL-412: en un unipersonal es el nombre de una persona.
 */
@Injectable()
export class ConfiguracionEstablecimientoService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auditLog: AuditLogService,
    // HU-042 (BL-465): avisar al KDS cuando cambia la configuración de la cola.
    private readonly kdsGateway: KdsGateway,
    // HU-043 (BL-532): validar el logo y firmar su URL.
    private readonly storage: StorageService,
  ) {}

  async obtener(tenantId: string): Promise<ConfiguracionEstablecimiento> {
    const actual = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      this.leer(tx, tenantId),
    );
    return this.armarRespuesta(actual);
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
    // HU-043 (BL-532 y BL-562): antes de abrir la transacción (consultan el
    // bucket).
    if (typeof dto.logoKey === 'string') {
      await this.validarImagenDeMarca('logo', dto.logoKey, tenantId);
    }
    if (typeof dto.portadaKey === 'string') {
      await this.validarImagenDeMarca('portada', dto.portadaKey, tenantId);
    }

    const resultado = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx): Promise<ResultadoActualizacion> => {
        const actual = await this.leer(tx, tenantId);
        // HU-038 (BL-506): el PATCH es parcial, así que el orden de los
        // umbrales se controla con lo que quedaría guardado (lo nuevo más lo
        // actual). La base tiene el mismo control (CHECK).
        const errorOrden = errorOrdenUmbrales(
          umbralesCombinados(actual.restaurante, dto),
        );
        if (errorOrden) throw new BadRequestException(errorOrden);

        validarHorarioRetiro(actual.restaurante, dto);
        const cambios = calcularCambios(actual, dto);
        if (cambios.campos.length === 0) {
          return {
            guardado: actual,
            cambioLaCola: false,
            promovidos: [],
            umbralesEspera: null,
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
    // HU-038 (BL-506): los KDS abiertos (también el /kds de Cocina) toman los
    // umbrales nuevos sin recargar.
    if (resultado.umbralesEspera) {
      this.kdsGateway.emitirUmbralesEspera(tenantId, resultado.umbralesEspera);
    }
    return this.armarRespuesta(resultado.guardado);
  }

  /**
   * HU-043 (BL-532 y BL-562): el logo tiene que ser un logo publicado de
   * este establecimiento ({tenant}/menu/marca/{uuid}.webp), y la portada una
   * portada publicada ({tenant}/menu/portada/{uuid}.webp). Las dos tienen
   * que existir en el bucket. Mismo criterio que las imágenes de los ítems
   * (BL-387).
   */
  private async validarImagenDeMarca(
    tipo: 'logo' | 'portada',
    key: string,
    tenantId: string,
  ): Promise<void> {
    const esLogo = tipo === 'logo';
    const valida = esLogo
      ? this.storage.esKeyDeMarcaDelTenant(key, tenantId)
      : this.storage.esKeyDePortadaDelTenant(key, tenantId);
    if (!valida) {
      // Mismo mensaje para una key de otro tenant, de la cuarentena, de un
      // ítem o del otro tipo: no se revela si existe en otro establecimiento.
      throw new BadRequestException(
        esLogo
          ? 'El logo no es válido para este establecimiento'
          : 'La portada no es válida para este establecimiento',
      );
    }
    if (!(await this.storage.existeImagen(key))) {
      throw new BadRequestException(
        esLogo
          ? 'El logo indicado no existe. Volvé a subirlo.'
          : 'La portada indicada no existe. Volvé a subirla.',
      );
    }
  }

  /**
   * La respuesta de GET y PATCH: el logo y la portada van como URL firmada,
   * sin la key.
   */
  private async armarRespuesta(
    actual: Actual,
  ): Promise<ConfiguracionEstablecimiento> {
    const { logoKey, portadaKey, ...restaurante } = actual.restaurante;
    return {
      razonSocial: actual.razonSocial,
      rut: actual.rut,
      ...restaurante,
      // La columna es texto (con CHECK): acá se acota al tipo.
      plantilla: restaurante.plantilla as PlantillaMarca,
      logoUrl: logoKey ? await this.storage.urlFirmadaDeLectura(logoKey) : null,
      portadaUrl: portadaKey
        ? await this.storage.urlFirmadaDeLectura(portadaKey)
        : null,
      mediosPagoDisponibles: [...MEDIOS_PAGO_DISPONIBLES],
      proveedoresCfeDisponibles: [...PROVEEDORES_CFE_DISPONIBLES],
      plantillasDisponibles: [...PLANTILLAS_MARCA],
    };
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
      guardado: {
        razonSocial: cambios.razonSocial ?? actual.razonSocial,
        rut: actual.rut,
        restaurante,
      },
      cambioLaCola: cambios.campos.some((campo) =>
        CAMPOS_DE_LA_COLA.has(campo),
      ),
      promovidos,
      umbralesEspera: CAMPOS_DE_ESPERA.some((campo) =>
        cambios.campos.includes(campo),
      )
        ? umbralesDelRestaurante(restaurante)
        : null,
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

/** HU-038 (BL-506): los umbrales que quedarían guardados con este PATCH. */
function umbralesCombinados(
  actual: FilaUmbralesEspera,
  dto: ActualizarConfiguracionDto,
): FilaUmbralesEspera {
  return {
    minutosEsperaAtencion:
      dto.minutosEsperaAtencion ?? actual.minutosEsperaAtencion,
    minutosEsperaDemorado:
      dto.minutosEsperaDemorado ?? actual.minutosEsperaDemorado,
    minutosEsperaDemoraAlta:
      dto.minutosEsperaDemoraAlta ?? actual.minutosEsperaDemoraAlta,
  };
}

/**
 * La hora que va a quedar guardada. En el PATCH, `undefined` es «no la
 * cambies» y `null` es «borrala» (todo el día), así que no alcanza con `??`:
 * un null explícito tiene que ganarle a lo guardado.
 */
function horaQueQueda(
  enviada: string | null | undefined,
  guardada: string | null | undefined,
): string | null {
  if (enviada !== undefined) return enviada;
  return guardada ?? null;
}

/**
 * HU-040 (BL-210): con lo que viene y lo guardado, la franja del retiro
 * queda completa (las dos horas, distintas) o vacía (todo el día).
 */
function validarHorarioRetiro(
  actual: ConfiguracionDelRestaurante,
  dto: ActualizarConfiguracionDto,
): void {
  const desde = horaQueQueda(dto.retiroHoraDesde, actual.retiroHoraDesde);
  const hasta = horaQueQueda(dto.retiroHoraHasta, actual.retiroHoraHasta);
  if ((desde === null) !== (hasta === null)) {
    throw new BadRequestException(
      'Completá las dos horas del retiro, o dejá las dos vacías para tomar pedidos todo el día',
    );
  }
  if (desde !== null && desde === hasta) {
    throw new BadRequestException(
      'La hora de inicio y la de cierre del retiro tienen que ser distintas',
    );
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
