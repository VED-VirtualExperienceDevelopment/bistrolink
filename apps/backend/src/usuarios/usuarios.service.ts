import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  KeycloakAdminService,
  KeycloakUser,
} from '../keycloak-admin/keycloak-admin.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/audit-action.enum';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly keycloakAdmin: KeycloakAdminService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Personal del tenant (filas de `usuario`: Admin y Mozo) y, desde BL-362,
   * la cuenta de cocina, que vive solo en Keycloak (Anexo 6 §4.3). Cada
   * elemento trae `cuentaCompartida` para que la pantalla sepa qué acciones
   * ofrecer.
   */
  async listar(tenantId: string) {
    const filas = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.usuario.findMany({
        select: {
          id: true,
          keycloakId: true,
          username: true,
          email: true,
          nombre: true,
          apellido: true,
          rol: true,
          activo: true,
          restauranteId: true,
          createdAt: true,
        },
      }),
    );

    const personal = filas.map((fila) => ({
      ...fila,
      cuentaCompartida: false,
    }));
    const cocina = await this.listarCuentasCocina(
      tenantId,
      new Set(filas.map((fila) => fila.keycloakId)),
    );
    return this.conUltimoIngreso(tenantId, [...personal, ...cocina]);
  }

  /**
   * BL-368: suma `ultimoIngreso` (ISO, o null si no ingresó en los últimos
   * 90 días) con una sola búsqueda de eventos para todo el tenant. Si
   * Keycloak no responde (o la cuenta de servicio todavía no tiene
   * view-events), el listado sale igual, sin el campo: la pantalla no
   * muestra el dato antes que mostrar «sin ingresos» por error.
   */
  private async conUltimoIngreso<T extends { keycloakId: string }>(
    tenantId: string,
    usuarios: T[],
  ): Promise<(T & { ultimoIngreso?: string | null })[]> {
    if (usuarios.length === 0) return usuarios;
    try {
      const ultimos = await this.keycloakAdmin.ultimosIngresos(
        usuarios.map((u) => u.keycloakId),
      );
      return usuarios.map((u) => {
        const time = ultimos.get(u.keycloakId);
        return {
          ...u,
          ultimoIngreso: time ? new Date(time).toISOString() : null,
        };
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo leer el último ingreso de los usuarios del tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return usuarios;
    }
  }

  /**
   * BL-362: cuentas de Keycloak del tenant con rol COCINA (opción A: sin
   * cambiar el modelo de datos). Candidatas: las del tenant sin fila en
   * `usuario` (la de cocina y el comensal técnico); de esas, se queda con
   * las que tienen el rol.
   *
   * Si Keycloak no responde, el listado sale igual con el personal y queda
   * un aviso en el log: no tiene sentido que la pantalla entera falle por
   * la cuenta de cocina.
   */
  private async listarCuentasCocina(
    tenantId: string,
    keycloakIdsConFila: Set<string>,
  ) {
    try {
      const usuarios =
        await this.keycloakAdmin.listarUsuariosDelTenant(tenantId);
      const candidatos = usuarios.filter(
        (u) => !keycloakIdsConFila.has(u.id) && this.esDelTenant(u, tenantId),
      );
      const cuentas = [];
      for (const usuario of candidatos) {
        const roles = await this.keycloakAdmin.rolesDeRealm(usuario.id);
        if (roles.includes('COCINA')) {
          cuentas.push(this.aCuentaCocina(usuario));
        }
      }
      return cuentas;
    } catch (error) {
      this.logger.warn(
        `No se pudo listar la cuenta de cocina del tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * BL-362: restablecer la contraseña de la cuenta de cocina. Misma lógica
   * que para el personal (BL-359), pero la cuenta se identifica por su id de
   * Keycloak, porque no tiene fila en `usuario`.
   */
  async restablecerContrasenaCocina(
    tenantId: string,
    actorKeycloakId: string,
    keycloakId: string,
  ) {
    const cuenta = await this.obtenerCuentaCocinaOFallar(tenantId, keycloakId);
    if (cuenta.enabled === false) {
      throw new ConflictException(
        'La cuenta está desactivada: reactivala antes de restablecer su contraseña',
      );
    }

    const { temporaryPassword, sesionesCerradas } =
      await this.restablecerEnKeycloak(keycloakId);

    this.auditLog.registrar({
      action: AuditAction.USUARIO_CONTRASENA_RESTABLECIDA,
      tenantId,
      actorKeycloakId,
      targetUsuarioId: keycloakId,
      detalle: { rol: 'COCINA', cuentaCompartida: true, sesionesCerradas },
    });

    return { id: keycloakId, temporaryPassword, sesionesCerradas };
  }

  /**
   * BL-362: desactivar la cuenta de cocina. Mismo orden que con el personal:
   * primero se impide el ingreso y después se cierran las sesiones abiertas
   * (la KDS de la cocina deja de recibir pedidos hasta que se reactive).
   */
  async desactivarCocina(
    tenantId: string,
    actorKeycloakId: string,
    keycloakId: string,
  ) {
    await this.obtenerCuentaCocinaOFallar(tenantId, keycloakId);

    await this.keycloakAdmin.setEnabled(keycloakId, false);
    const sesionesCerradas = await this.keycloakAdmin.logoutUser(keycloakId);

    this.auditLog.registrar({
      action: AuditAction.USUARIO_DESACTIVADO,
      tenantId,
      actorKeycloakId,
      targetUsuarioId: keycloakId,
      detalle: { rol: 'COCINA', cuentaCompartida: true, sesionesCerradas },
    });

    return { desactivado: true as const, id: keycloakId };
  }

  /** BL-362: reactivar la cuenta de cocina. Si ya estaba activa, no hace nada. */
  async reactivarCocina(
    tenantId: string,
    actorKeycloakId: string,
    keycloakId: string,
  ) {
    const cuenta = await this.obtenerCuentaCocinaOFallar(tenantId, keycloakId);

    if (cuenta.enabled === false) {
      await this.keycloakAdmin.setEnabled(keycloakId, true);
      this.auditLog.registrar({
        action: AuditAction.USUARIO_REACTIVADO,
        tenantId,
        actorKeycloakId,
        targetUsuarioId: keycloakId,
        detalle: { rol: 'COCINA', cuentaCompartida: true },
      });
    }

    return { activo: true as const, id: keycloakId };
  }

  /**
   * BL-367: cerrar las sesiones abiertas de una persona sin desactivarla
   * (por ejemplo, una tablet compartida que quedó con la sesión de un mozo
   * que ya se fue del turno). Sigue activa: puede volver a ingresar.
   *
   * Keycloak cierra las sesiones y revoca los refresh tokens; el access
   * token que ya tenga cada dispositivo vence solo (15 min como mucho).
   */
  async cerrarSesiones(
    tenantId: string,
    actorKeycloakId: string,
    usuarioId: string,
  ) {
    // Bajo RLS: un usuario de otro tenant no aparece y responde 404.
    const usuario = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      this.obtenerOFallar(tx, usuarioId),
    );
    await this.cerrarSesionesEnKeycloak(usuario.keycloakId);

    this.auditLog.registrar({
      action: AuditAction.USUARIO_SESIONES_CERRADAS,
      tenantId,
      actorKeycloakId,
      targetUsuarioId: usuarioId,
      detalle: { rol: usuario.rol },
    });

    return { id: usuarioId, sesionesCerradas: true as const };
  }

  /** BL-367: lo mismo para la cuenta de cocina (BL-362). */
  async cerrarSesionesCocina(
    tenantId: string,
    actorKeycloakId: string,
    keycloakId: string,
  ) {
    await this.obtenerCuentaCocinaOFallar(tenantId, keycloakId);
    await this.cerrarSesionesEnKeycloak(keycloakId);

    this.auditLog.registrar({
      action: AuditAction.USUARIO_SESIONES_CERRADAS,
      tenantId,
      actorKeycloakId,
      targetUsuarioId: keycloakId,
      detalle: { rol: 'COCINA', cuentaCompartida: true },
    });

    return { id: keycloakId, sesionesCerradas: true as const };
  }

  /**
   * logoutUser no lanza (en desactivar y restablecer, el cierre de sesiones
   * es un paso secundario). Acá es la acción misma: si Keycloak no las
   * cierra, se responde 503 para que el admin sepa que tiene que reintentar,
   * y no se audita algo que no pasó.
   */
  private async cerrarSesionesEnKeycloak(keycloakId: string) {
    const cerradas = await this.keycloakAdmin.logoutUser(keycloakId);
    if (!cerradas) {
      throw new ServiceUnavailableException(
        'No se pudieron cerrar las sesiones. Probá de nuevo en un momento.',
      );
    }
  }

  /**
   * BL-362: la cuenta existe, es del tenant del token y tiene el rol COCINA.
   * Cualquier otro caso responde 404, sin distinguir cuál: así un admin no
   * puede usar estas rutas para tocar otra cuenta de Keycloak (de otro
   * tenant, de plataforma o el comensal técnico) ni averiguar si existe.
   */
  private async obtenerCuentaCocinaOFallar(
    tenantId: string,
    keycloakId: string,
  ): Promise<KeycloakUser> {
    const usuario = await this.keycloakAdmin.findUserById(keycloakId);
    if (!usuario || !this.esDelTenant(usuario, tenantId)) {
      throw new NotFoundException('Cuenta de cocina no encontrada');
    }
    const roles = await this.keycloakAdmin.rolesDeRealm(keycloakId);
    if (!roles.includes('COCINA')) {
      throw new NotFoundException('Cuenta de cocina no encontrada');
    }
    return usuario;
  }

  private esDelTenant(usuario: KeycloakUser, tenantId: string): boolean {
    return usuario.attributes?.tenant_id?.includes(tenantId) ?? false;
  }

  /** Cómo se lista la cuenta de cocina: mismos campos que una fila de `usuario`. */
  private aCuentaCocina(usuario: KeycloakUser) {
    return {
      id: usuario.id,
      keycloakId: usuario.id,
      username: usuario.username,
      email: usuario.email ?? null,
      nombre: usuario.firstName ?? null,
      apellido: usuario.lastName ?? null,
      rol: 'COCINA' as const,
      activo: usuario.enabled !== false,
      restauranteId: null,
      createdAt: usuario.createdTimestamp
        ? new Date(usuario.createdTimestamp)
        : null,
      cuentaCompartida: true,
    };
  }

  async crear(
    tenantId: string,
    actorKeycloakId: string,
    dto: CreateUsuarioDto,
  ) {
    // Verificar que el restaurante indicado pertenezca al tenant del Admin
    // que hace la request. RLS ya filtra esta query por tenant_id, así que
    // si el restaurante es de otro tenant, simplemente no aparece acá —
    // sin esto, se podría insertar un usuario apuntando a un restaurante
    // ajeno, un dato inconsistente aunque quedara aislado igual por RLS.
    const restaurante = await this.tenantPrisma.runInTenantContext(
      tenantId,
      (tx) => tx.restaurante.findUnique({ where: { id: dto.restauranteId } }),
    );
    if (!restaurante) {
      throw new ForbiddenException(
        'El restaurante indicado no pertenece a tu establecimiento',
      );
    }

    // Genera una contraseña temporal aleatoria — el usuario la cambia en su
    // primer login (Keycloak la marca como "temporary": true).
    const temporaryPassword = this.generarContrasenaTemporal();

    // BL-361: nombre y apellido van a Keycloak (firstName/lastName, los lee
    // el encabezado desde el token) y a la fila (los lee el listado).
    const keycloakId = await this.keycloakAdmin.createUser({
      username: dto.username,
      email: dto.email,
      firstName: dto.nombre,
      lastName: dto.apellido,
      tenantId,
      temporaryPassword,
    });

    try {
      await this.keycloakAdmin.assignRealmRole(keycloakId, dto.rol);

      const usuario = await this.tenantPrisma.runInTenantContext(
        tenantId,
        (tx) =>
          tx.usuario.create({
            data: {
              tenantId,
              restauranteId: dto.restauranteId,
              keycloakId,
              username: dto.username,
              email: dto.email,
              nombre: dto.nombre,
              apellido: dto.apellido,
              rol: dto.rol,
            },
          }),
      );

      // [S] DoD HU-013: alta de cuenta auditada en Pino, nivel INFO.
      // El campo `rol` en el detalle permite filtrar específicamente las
      // altas de cuentas Administrador en Grafana Loki.
      this.auditLog.registrar({
        action: AuditAction.USUARIO_CREADO,
        tenantId,
        actorKeycloakId,
        targetUsuarioId: usuario.id,
        detalle: { rol: usuario.rol, restauranteId: usuario.restauranteId },
      });

      return { ...usuario, temporaryPassword };
    } catch (error) {
      // Compensación: la identidad en Keycloak ya existe, pero algo falló
      // después (asignar el rol, o persistir la fila en Postgres). Sin esto,
      // quedaría un usuario en Keycloak sin fila correspondiente en la base
      // — un huérfano invisible para listar()/actualizar()/desactivar().
      try {
        await this.keycloakAdmin.deleteUser(keycloakId);
      } catch (cleanupError) {
        // No ocultamos el error original (es el que le importa a quien hizo
        // la request), pero sí dejamos rastro de que la compensación
        // también falló — este caso sí requiere intervención manual.
        this.logger.error(
          `No se pudo revertir el usuario ${keycloakId} en Keycloak tras un fallo en crear(). Requiere limpieza manual.`,
          cleanupError instanceof Error ? cleanupError.stack : cleanupError,
        );
      }
      throw error;
    }
  }

  /**
   * PATCH /usuarios/:id: cambia el rol (HU-013) y, desde BL-366, el nombre,
   * el apellido y el correo. Se cambia solo lo que viene en el body.
   *
   * Orden, dentro de la transacción con el lock por tenant:
   * 1. RF.19 si se le baja el rol a un Admin.
   * 2. Perfil en Keycloak (nombre, apellido, correo). Va primero porque es
   *    lo que más probablemente falla (un correo ya usado: 409); si falla,
   *    no se cambió nada.
   * 3. Rol en Keycloak.
   * 4. La fila de `usuario`. Si Keycloak falló antes, hay rollback.
   *
   * La cuenta de cocina no tiene fila: responde 404 (BL-362, no se edita).
   */
  async actualizar(
    tenantId: string,
    actorKeycloakId: string,
    usuarioId: string,
    dto: UpdateUsuarioDto,
  ) {
    const { actualizado, rolAnterior, cambiaRol, camposPerfil } =
      await this.tenantPrisma.runInTenantContext(
        tenantId,
        async (tx) => {
          // Advisory lock por tenant: serializa las operaciones que dependen
          // del conteo de Admins activos (RF.19), para que dos requests
          // concurrentes no lean el mismo conteo antes de que la primera
          // termine de escribir su cambio.
          await this.lockTenant(tx, tenantId);

          const usuario = await this.obtenerOFallar(tx, usuarioId);

          // Solo lo que cambia de verdad: mandar el mismo valor no cuenta.
          const cambiaRol = dto.rol !== undefined && dto.rol !== usuario.rol;
          const perfil: {
            firstName?: string;
            lastName?: string;
            email?: string;
          } = {};
          const camposPerfil: string[] = [];
          if (dto.nombre !== undefined && dto.nombre !== usuario.nombre) {
            perfil.firstName = dto.nombre;
            camposPerfil.push('nombre');
          }
          if (dto.apellido !== undefined && dto.apellido !== usuario.apellido) {
            perfil.lastName = dto.apellido;
            camposPerfil.push('apellido');
          }
          if (dto.email !== undefined && dto.email !== usuario.email) {
            perfil.email = dto.email;
            camposPerfil.push('email');
          }
          if (!cambiaRol && camposPerfil.length === 0) {
            throw new BadRequestException('No hay cambios para guardar');
          }

          if (cambiaRol && usuario.rol === 'ADMIN' && dto.rol !== 'ADMIN') {
            await this.asegurarNoEsUltimoAdmin(tx, usuarioId);
          }

          if (camposPerfil.length > 0) {
            await this.keycloakAdmin.actualizarPerfil(
              usuario.keycloakId,
              perfil,
            );
          }
          if (cambiaRol) {
            await this.keycloakAdmin.assignRealmRole(
              usuario.keycloakId,
              dto.rol as string,
            );
          }

          const actualizado = await tx.usuario.update({
            where: { id: usuarioId },
            data: {
              ...(cambiaRol ? { rol: dto.rol } : {}),
              ...(perfil.firstName !== undefined
                ? { nombre: perfil.firstName }
                : {}),
              ...(perfil.lastName !== undefined
                ? { apellido: perfil.lastName }
                : {}),
              ...(perfil.email !== undefined ? { email: perfil.email } : {}),
            },
          });

          return {
            actualizado,
            rolAnterior: usuario.rol,
            cambiaRol,
            camposPerfil,
          };
        },
        { timeout: 10_000 }, // margen extra: la transacción espera a Keycloak
      );

    // [S] DoD HU-013: todo cambio de rol se audita en Pino, nivel INFO —
    // fuera de la transacción, para no loguear un cambio que terminó en
    // rollback si algo posterior a esta línea fallara.
    if (cambiaRol) {
      this.auditLog.registrar({
        action: AuditAction.USUARIO_ROL_MODIFICADO,
        tenantId,
        actorKeycloakId,
        targetUsuarioId: usuarioId,
        detalle: { rolAnterior, rolNuevo: actualizado.rol },
      });
    }
    // BL-366: qué campos cambiaron, sin los valores (son datos personales).
    if (camposPerfil.length > 0) {
      this.auditLog.registrar({
        action: AuditAction.USUARIO_DATOS_MODIFICADOS,
        tenantId,
        actorKeycloakId,
        targetUsuarioId: usuarioId,
        detalle: { rol: actualizado.rol, campos: camposPerfil },
      });
    }

    return { ...actualizado, cuentaCompartida: false };
  }

  async desactivar(
    tenantId: string,
    actorKeycloakId: string,
    usuarioId: string,
  ) {
    const resultado = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        await this.lockTenant(tx, tenantId);

        const usuario = await this.obtenerOFallar(tx, usuarioId);

        if (usuario.rol === 'ADMIN') {
          try {
            await this.asegurarNoEsUltimoAdmin(tx, usuarioId);
          } catch (error) {
            if (error instanceof ConflictException) {
              // [S] DoD HU-013: el intento rechazado también es un evento
              // de seguridad relevante (alguien intentó dejar el tenant
              // sin Administrador) — se audita igual que el caso exitoso.
              this.auditLog.registrar({
                action: AuditAction.USUARIO_DESACTIVACION_RECHAZADA,
                tenantId,
                actorKeycloakId,
                targetUsuarioId: usuarioId,
                detalle: { rol: usuario.rol, motivo: 'ultimo_admin_activo' },
              });
            }
            throw error;
          }
        }

        // Si esto falla, la transacción entera hace rollback — el lock se
        // libera y activo nunca queda en false sobre un usuario que en los
        // hechos sigue habilitado en Keycloak.
        await this.keycloakAdmin.setEnabled(usuario.keycloakId, false);

        await tx.usuario.update({
          where: { id: usuarioId },
          data: { activo: false },
        });

        return {
          desactivado: true,
          id: usuarioId,
          rol: usuario.rol,
          keycloakId: usuario.keycloakId,
        };
      },
      { timeout: 10_000 },
    );

    // BL-272: setEnabled(false) solo frena los logins nuevos; acá se cierran
    // las sesiones abiertas y se revocan los refresh tokens. Va después del
    // commit y no lanza: si falla, la baja ya está hecha y el access token
    // vigente vence solo. El resultado queda en el audit log.
    const sesionesCerradas = await this.keycloakAdmin.logoutUser(
      resultado.keycloakId,
    );

    this.auditLog.registrar({
      action: AuditAction.USUARIO_DESACTIVADO,
      tenantId,
      actorKeycloakId,
      targetUsuarioId: usuarioId,
      detalle: { rol: resultado.rol, sesionesCerradas },
    });

    return { desactivado: resultado.desactivado, id: resultado.id };
  }

  /**
   * BL-358: vuelve a habilitar a un usuario desactivado (por ejemplo, un
   * mozo de temporada que vuelve). Mismo orden que desactivar(): primero
   * Keycloak y después Postgres, dentro de la misma transacción. Si
   * Keycloak falla, la transacción hace rollback y `activo` sigue en false,
   * así la base nunca muestra como activo a alguien que no puede ingresar.
   *
   * No hace falta revisar RF.19: reactivar solo puede sumar Admins activos.
   * El lock por tenant se toma igual, para que una reactivación y una
   * desactivación concurrentes del mismo tenant no se pisen.
   *
   * Las sesiones viejas no reviven: desactivar() ya las cerró y revocó sus
   * refresh tokens (BL-272), así que el usuario tiene que volver a ingresar.
   */
  async reactivar(
    tenantId: string,
    actorKeycloakId: string,
    usuarioId: string,
  ) {
    const resultado = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        await this.lockTenant(tx, tenantId);

        // Bajo RLS: un usuario de otro tenant no aparece y responde 404.
        const usuario = await this.obtenerOFallar(tx, usuarioId);

        // Ya activo: no hay nada que hacer ni que auditar. Responder igual
        // con éxito evita un error si el admin hace doble clic o si otra
        // persona lo reactivó un momento antes.
        if (usuario.activo) {
          return { yaEstabaActivo: true, rol: usuario.rol };
        }

        await this.keycloakAdmin.setEnabled(usuario.keycloakId, true);

        await tx.usuario.update({
          where: { id: usuarioId },
          data: { activo: true },
        });

        return { yaEstabaActivo: false, rol: usuario.rol };
      },
      { timeout: 10_000 }, // margen extra: la transacción espera a Keycloak
    );

    // [S] Igual que la baja: se audita fuera de la transacción, para no
    // registrar una reactivación que terminó en rollback.
    if (!resultado.yaEstabaActivo) {
      this.auditLog.registrar({
        action: AuditAction.USUARIO_REACTIVADO,
        tenantId,
        actorKeycloakId,
        targetUsuarioId: usuarioId,
        detalle: { rol: resultado.rol },
      });
    }

    return { activo: true as const, id: usuarioId };
  }

  /**
   * BL-359: el admin resuelve un «me olvidé la contraseña» sin soporte.
   *
   * 1. Genera una contraseña temporal nueva, igual que el alta: Keycloak
   *    pide cambiarla en el próximo ingreso.
   * 2. Cierra las sesiones abiertas del usuario. Así, si alguien más tenía
   *    su sesión iniciada (por ejemplo en una tablet compartida), queda
   *    afuera. Igual que en desactivar(), no lanza: si falla, la contraseña
   *    ya cambió y el resultado queda en la auditoría.
   * 3. Audita la acción. [S] La contraseña no se loguea ni se audita: solo
   *    viaja en la respuesta, que el diálogo muestra una única vez.
   *
   * Un usuario desactivado responde 409: no podría ingresar con la
   * temporal, y mostrarla sería engañoso. Primero hay que reactivarlo.
   */
  async restablecerContrasena(
    tenantId: string,
    actorKeycloakId: string,
    usuarioId: string,
  ) {
    // Bajo RLS: un usuario de otro tenant no aparece y responde 404. No hay
    // escritura en Postgres, así que alcanza con leer la fila.
    const usuario = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      this.obtenerOFallar(tx, usuarioId),
    );

    if (!usuario.activo) {
      throw new ConflictException(
        'El usuario está desactivado: reactivalo antes de restablecer su contraseña',
      );
    }

    const { temporaryPassword, sesionesCerradas } =
      await this.restablecerEnKeycloak(usuario.keycloakId);

    this.auditLog.registrar({
      action: AuditAction.USUARIO_CONTRASENA_RESTABLECIDA,
      tenantId,
      actorKeycloakId,
      targetUsuarioId: usuarioId,
      detalle: { rol: usuario.rol, sesionesCerradas },
    });

    return { id: usuarioId, temporaryPassword, sesionesCerradas };
  }

  /**
   * Contraseña temporal nueva y cierre de sesiones, común al personal
   * (BL-359) y a la cuenta de cocina (BL-362). Si Keycloak no cambia la
   * contraseña, lanza y no se cierra nada; el cierre de sesiones no lanza.
   */
  private async restablecerEnKeycloak(keycloakId: string) {
    const temporaryPassword = this.generarContrasenaTemporal();
    await this.keycloakAdmin.resetPassword(keycloakId, temporaryPassword);
    const sesionesCerradas = await this.keycloakAdmin.logoutUser(keycloakId);
    return { temporaryPassword, sesionesCerradas };
  }

  /**
   * 12 bytes aleatorios en base64url: 16 caracteres, por encima del mínimo
   * de 9 de la política del realm (BL-266). Se usa en el alta y al
   * restablecer, así las dos generan contraseñas con el mismo criterio.
   */
  private generarContrasenaTemporal(): string {
    return randomBytes(12).toString('base64url');
  }

  private async obtenerOFallar(tx: PrismaClient, usuarioId: string) {
    const usuario = await tx.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return usuario;
  }

  /** RF.19: nunca puede quedar un tenant sin ningún Admin activo. */
  private async asegurarNoEsUltimoAdmin(tx: PrismaClient, usuarioId: string) {
    const totalAdmins = await tx.usuario.count({
      where: { rol: 'ADMIN', activo: true, id: { not: usuarioId } },
    });
    if (totalAdmins === 0) {
      throw new ConflictException(
        'No es posible desactivar o cambiar el rol de la última cuenta Administrador del tenant (RF.19)',
      );
    }
  }

  /**
   * Advisory lock scopeado a la transacción actual (pg lo libera solo al
   * hacer commit/rollback). Usamos hashtext(tenantId) como clave para
   * serializar, por tenant, las operaciones sensibles a RF.19 sin necesitar
   * bloquear filas específicas que quizás todavía no existen.
   */
  private async lockTenant(tx: PrismaClient, tenantId: string) {
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      tenantId,
    );
  }
}
