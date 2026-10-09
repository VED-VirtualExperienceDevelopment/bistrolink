import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { MesaEstado, Prisma, PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  KeycloakAdminService,
  PerfilKeycloak,
} from '../keycloak-admin/keycloak-admin.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import { AprovisionarEstablecimientoDto } from './dto/aprovisionar-establecimiento.dto';

/** Contraseñas iniciales de Admin y Cocina. Si falta una, se genera una temporal. */
export interface CredencialesIniciales {
  admin?: string;
  cocina?: string;
}

/**
 * Quién da el alta. `id` va al registro de auditoría (el sub del token, o
 * "script:<usuario>"); `nombre` se guarda en tenant.creado_por para mostrarlo.
 * Si no viene `nombre` (alta desde el endpoint), se busca el username en
 * Keycloak a partir del `id`.
 */
export interface ActorAlta {
  id: string;
  nombre?: string;
}

export type RolAprovisionado = 'ADMIN' | 'COCINA' | 'COMENSAL';

export interface UsuarioAprovisionado {
  rol: RolAprovisionado;
  username: string;
  keycloakId: string;
  /** false si el usuario ya existía (no se le tocó la contraseña). */
  creado: boolean;
  /**
   * Solo en usuarios que ya existían: true si les faltaba email, nombre o
   * apellido y se completaron en esta corrida.
   */
  perfilCompletado?: boolean;
  /**
   * Solo cuando el servicio generó la contraseña (usuario nuevo sin
   * contraseña provista). Es temporal: Keycloak obliga a cambiarla en el
   * primer login. Quien llama decide dónde guardarla; nunca se loguea.
   */
  passwordGenerada?: string;
}

export interface ResultadoAprovisionamiento {
  tenantId: string;
  tenantCreado: boolean;
  restauranteId: string;
  restauranteCreado: boolean;
  mesaVirtualId: string;
  usuarios: UsuarioAprovisionado[];
}

interface DatosEstablecimiento {
  tenantCreado: boolean;
  restauranteId: string;
  restauranteCreado: boolean;
  mesaVirtualId: string;
}

const PLAN_POR_DEFECTO = 'BASICO';
const TIMEZONE_POR_DEFECTO = 'America/Montevideo';
// Dominio ficticio, nunca se usa para enviar nada (mismo que
// scripts/provision-comensal-tecnico.ts).
const DOMINIO_EMAIL_TECNICO = 'tecnico.bistrolink.local';
// Las cuentas Cocina y comensal no son personas, pero el perfil del realm
// exige nombre y apellido. Valores fijos y sin símbolos: el validador de
// nombres de Keycloak rechaza caracteres como & o /, que un nombre de
// restaurante puede tener.
const APELLIDO_CUENTA_TECNICA = 'BistroLink';

/**
 * BL-163 (HU-027): alta de un establecimiento con el kit mínimo de un
 * restaurante activo: Tenant, su único Restaurante, mesa virtual, cuenta
 * Administrador (Keycloak + fila en `usuario`), cuenta Cocina (solo Keycloak)
 * y usuario técnico del comensal (`comensal-<tenantId>`).
 *
 * Idempotente: correrlo de nuevo con los mismos datos no duplica nada ni
 * cambia contraseñas de usuarios que ya existen. Por eso, si algo falla a
 * mitad de camino (por ejemplo, Keycloak no responde), la recuperación es
 * volver a correrlo.
 *
 * Orden: primero la base (una transacción con el contexto del tenant nuevo,
 * así las políticas RLS aceptan las filas), después Keycloak y al final la
 * fila del Administrador en `usuario`, que necesita su id de Keycloak.
 *
 * Lo usa el script `scripts/aprovisionar-establecimiento.ts` y, en la
 * entrega 2, el endpoint de plataforma.
 */
@Injectable()
export class AprovisionamientoService {
  private readonly logger = new Logger(AprovisionamientoService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly keycloakAdmin: KeycloakAdminService,
    private readonly auditLog: AuditLogService,
  ) {}

  private get comensalPassword(): string {
    const password = process.env.KEYCLOAK_COMENSAL_PASSWORD;
    if (!password) {
      throw new Error(
        'Falta KEYCLOAK_COMENSAL_PASSWORD: es la contraseña del usuario técnico del comensal, la misma para todos los tenants.',
      );
    }
    return password;
  }

  async aprovisionar(
    dto: AprovisionarEstablecimientoDto,
    credenciales: CredencialesIniciales,
    actor: ActorAlta,
  ): Promise<ResultadoAprovisionamiento> {
    this.validarUsernames(dto);
    // Falla antes de escribir nada si falta la contraseña del comensal.
    const comensalPassword = this.comensalPassword;
    const creadoPor = await this.nombreDelActor(actor);

    const tenantId =
      dto.tenantId ?? (await this.buscarTenantPorRut(dto.rut)) ?? randomUUID();

    const datos = await this.tenantPrisma
      .runInTenantContext(tenantId, (tx) =>
        this.asegurarDatosDelEstablecimiento(tx, tenantId, dto, creadoPor),
      )
      .catch((err) => this.traducirConflicto(err));

    // Uno por vez, en orden: si falla uno, los anteriores ya quedaron bien y
    // el reintento los encuentra.
    const admin = await this.asegurarUsuario({
      rol: 'ADMIN',
      username: dto.admin.username,
      perfil: {
        email: dto.admin.email,
        firstName: dto.admin.nombre,
        lastName: dto.admin.apellido,
      },
      tenantId,
      password: credenciales.admin,
    });
    const cocina = await this.asegurarUsuario({
      rol: 'COCINA',
      username: dto.cocina.username,
      perfil: {
        email:
          dto.cocina.email ?? `${dto.cocina.username}@${DOMINIO_EMAIL_TECNICO}`,
        firstName: 'Cocina',
        lastName: APELLIDO_CUENTA_TECNICA,
      },
      tenantId,
      password: credenciales.cocina,
    });
    const comensal = await this.asegurarUsuario({
      rol: 'COMENSAL',
      username: `comensal-${tenantId}`,
      perfil: {
        email: `comensal-${tenantId}@${DOMINIO_EMAIL_TECNICO}`,
        firstName: 'Comensal',
        lastName: APELLIDO_CUENTA_TECNICA,
      },
      tenantId,
      password: comensalPassword,
    });

    const filaAdmin = await this.tenantPrisma
      .runInTenantContext(tenantId, (tx) =>
        tx.usuario.upsert({
          where: { keycloakId: admin.keycloakId },
          update: {},
          create: {
            tenantId,
            restauranteId: datos.restauranteId,
            keycloakId: admin.keycloakId,
            username: dto.admin.username,
            email: dto.admin.email,
            rol: 'ADMIN',
          },
          select: { id: true },
        }),
      )
      .catch((err) => this.traducirConflicto(err));

    const usuarios = [admin, cocina, comensal];

    // [S] Sin usernames ni contraseñas en el registro (mismo criterio que
    // HU-013): alcanza con los ids y qué se creó en esta corrida.
    this.auditLog.registrar({
      action: AuditAction.ESTABLECIMIENTO_APROVISIONADO,
      tenantId,
      actorKeycloakId: actor.id,
      targetUsuarioId: filaAdmin.id,
      detalle: {
        restauranteId: datos.restauranteId,
        tenantCreado: datos.tenantCreado,
        restauranteCreado: datos.restauranteCreado,
        usuariosCreados: usuarios.filter((u) => u.creado).map((u) => u.rol),
      },
    });

    return {
      tenantId,
      tenantCreado: datos.tenantCreado,
      restauranteId: datos.restauranteId,
      restauranteCreado: datos.restauranteCreado,
      mesaVirtualId: datos.mesaVirtualId,
      usuarios,
    };
  }

  /**
   * Nombre que se guarda en tenant.creado_por: el que viene, o el username
   * del usuario de Keycloak con ese id. Si no se encuentra, el id (mejor que
   * nada, y sigue identificando a la persona en la auditoría).
   */
  private async nombreDelActor(actor: ActorAlta): Promise<string> {
    if (actor.nombre) {
      return actor.nombre;
    }
    const usuario = await this.keycloakAdmin.findUserById(actor.id);
    return usuario?.username ?? actor.id;
  }

  private validarUsernames(dto: AprovisionarEstablecimientoDto) {
    if (dto.admin.username === dto.cocina.username) {
      throw new BadRequestException(
        'El Administrador y la cuenta Cocina tienen que tener usernames distintos',
      );
    }
    for (const { username } of [dto.admin, dto.cocina]) {
      if (username.startsWith('comensal-')) {
        throw new BadRequestException(
          'Los usernames que empiezan con "comensal-" están reservados para el usuario técnico del comensal',
        );
      }
    }
  }

  /**
   * `tenant` no tiene RLS (es la raíz del aislamiento), así que la búsqueda
   * por RUT ve todos los tenants. runInTenantContext exige un tenantId: se
   * usa uno provisorio que no corresponde a ningún dato.
   */
  private async buscarTenantPorRut(rut: string): Promise<string | undefined> {
    const tenant = await this.tenantPrisma.runInTenantContext(
      randomUUID(),
      (tx) => tx.tenant.findUnique({ where: { rut }, select: { id: true } }),
    );
    return tenant?.id;
  }

  private async asegurarDatosDelEstablecimiento(
    tx: PrismaClient,
    tenantId: string,
    dto: AprovisionarEstablecimientoDto,
    creadoPor: string,
  ): Promise<DatosEstablecimiento> {
    // Tenant: el RUT y el id tienen que coincidir con lo que ya exista.
    const tenantPorRut = await tx.tenant.findUnique({
      where: { rut: dto.rut },
      select: { id: true },
    });
    if (tenantPorRut && tenantPorRut.id !== tenantId) {
      throw new ConflictException('El RUT ya pertenece a otro establecimiento');
    }
    const tenantPorId = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { rut: true },
    });
    if (tenantPorId && tenantPorId.rut !== dto.rut) {
      throw new ConflictException(
        'El tenantId indicado ya existe con otro RUT',
      );
    }

    let tenantCreado = false;
    if (!tenantPorId) {
      await tx.tenant.create({
        data: {
          id: tenantId,
          razonSocial: dto.razonSocial,
          rut: dto.rut,
          plan: dto.plan ?? PLAN_POR_DEFECTO,
          creadoPor,
        },
      });
      tenantCreado = true;
    }

    // Restaurante: uno por tenant (restaurante.tenant_id es único).
    let restaurante = await tx.restaurante.findUnique({
      where: { tenantId },
      select: { id: true },
    });
    if (
      restaurante &&
      dto.restaurante.id &&
      restaurante.id !== dto.restaurante.id
    ) {
      throw new ConflictException(
        'El establecimiento ya tiene otro restaurante (un tenant tiene un solo restaurante)',
      );
    }

    let restauranteCreado = false;
    if (!restaurante) {
      restaurante = await tx.restaurante.create({
        data: {
          id: dto.restaurante.id,
          tenantId,
          nombre: dto.restaurante.nombre,
          direccion: dto.restaurante.direccion,
          timezone: dto.restaurante.timezone ?? TIMEZONE_POR_DEFECTO,
        },
        select: { id: true },
      });
      restauranteCreado = true;
    }

    // Mesa virtual (HU-003): numero 0, nunca se dibuja en el mapa. Se crea
    // en el alta; el upsert de PedidosService queda como respaldo.
    const mesaVirtual = await tx.mesa.upsert({
      where: {
        restauranteId_numero: { restauranteId: restaurante.id, numero: 0 },
      },
      update: {},
      create: {
        tenantId,
        restauranteId: restaurante.id,
        numero: 0,
        estado: MesaEstado.LIBRE,
        esVirtual: true,
      },
      select: { id: true, esVirtual: true },
    });
    if (!mesaVirtual.esVirtual) {
      throw new ConflictException(
        'El restaurante ya tiene una mesa número 0 que no es la mesa virtual',
      );
    }

    return {
      tenantCreado,
      restauranteId: restaurante.id,
      restauranteCreado,
      mesaVirtualId: mesaVirtual.id,
    };
  }

  /**
   * Crea el usuario en Keycloak si no existe, o verifica el existente.
   *
   * - Existente: tiene que pertenecer a este tenant (si no, se rechaza en
   *   lugar de "adoptarlo"). No se le cambia la contraseña. El rol se asigna
   *   igual: asignar un rol que ya tiene no cambia nada. Si le falta email,
   *   nombre o apellido, se completan (sin pisar los que ya tiene).
   * - Nuevo con contraseña provista: contraseña permanente (cuentas de prueba
   *   y comensal técnico, que se loguea por password grant).
   * - Nuevo sin contraseña: se genera una temporal y se devuelve.
   */
  private async asegurarUsuario(p: {
    rol: RolAprovisionado;
    username: string;
    perfil: PerfilKeycloak;
    tenantId: string;
    password?: string;
  }): Promise<UsuarioAprovisionado> {
    const existente = await this.keycloakAdmin.findUserByUsername(p.username);

    if (existente) {
      const tenantDelUsuario = existente.attributes?.tenant_id?.[0];
      if (tenantDelUsuario !== p.tenantId) {
        throw new ConflictException(
          `El usuario ${p.username} ya existe y no pertenece a este establecimiento`,
        );
      }
      const perfilIncompleto =
        !existente.email || !existente.firstName || !existente.lastName;
      const perfilCompletado = perfilIncompleto
        ? await this.keycloakAdmin.completarPerfil(existente.id, p.perfil)
        : false;
      await this.keycloakAdmin.assignRealmRole(existente.id, p.rol);
      return {
        rol: p.rol,
        username: p.username,
        keycloakId: existente.id,
        creado: false,
        perfilCompletado,
      };
    }

    const passwordGenerada = p.password
      ? undefined
      : randomBytes(12).toString('base64url');

    const keycloakId = await this.keycloakAdmin.createUser({
      username: p.username,
      email: p.perfil.email,
      firstName: p.perfil.firstName,
      lastName: p.perfil.lastName,
      tenantId: p.tenantId,
      temporaryPassword: p.password ?? (passwordGenerada as string),
      temporary: !p.password,
    });

    try {
      await this.keycloakAdmin.assignRealmRole(keycloakId, p.rol);
    } catch (error) {
      // Compensación (mismo criterio que UsuariosService.crear): sin rol, el
      // usuario no sirve, y el reintento lo encontraría y no lo recrearía.
      try {
        await this.keycloakAdmin.deleteUser(keycloakId);
      } catch (cleanupError) {
        this.logger.error(
          `No se pudo revertir el usuario ${keycloakId} en Keycloak tras fallar la asignación del rol ${p.rol}. Requiere limpieza manual.`,
          cleanupError instanceof Error ? cleanupError.stack : cleanupError,
        );
      }
      throw error;
    }

    return {
      rol: p.rol,
      username: p.username,
      keycloakId,
      creado: true,
      ...(passwordGenerada ? { passwordGenerada } : {}),
    };
  }

  /**
   * Un id que choca con datos de otro tenant (por ejemplo, un restauranteId
   * fijo que ya usa otro establecimiento, o una fila de `usuario` con ese
   * keycloakId en otro tenant) llega como violación de unicidad (P2002): se
   * devuelve como conflicto, no como error interno.
   */
  private traducirConflicto(err: unknown): never {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictException(
        'Alguno de los datos del establecimiento ya existe en otro establecimiento',
      );
    }
    throw err;
  }
}
