import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

export interface KeycloakUserPayload {
  username: string;
  email?: string;
  /**
   * BL-163: el perfil de usuario del realm exige email, nombre y apellido.
   * Si faltan, Keycloak pide completarlos en el primer login (VERIFY_PROFILE)
   * y rechaza el password grant ("Account is not fully set up").
   */
  firstName?: string;
  lastName?: string;
  /**
   * Obligatorio para todo usuario de un establecimiento. Solo los usuarios
   * de plataforma (BL-163, rol PLATAFORMA) se crean sin tenant_id.
   */
  tenantId?: string;
  /**
   * Acciones que Keycloak exige en el primer login. BL-163: los usuarios de
   * plataforma se crean con CONFIGURE_TOTP (OTP obligatorio).
   */
  requiredActions?: string[];
  temporaryPassword: string;
  /**
   * Si la contraseña es temporal (Keycloak obliga a cambiarla en el primer
   * login). Por defecto true, como en el alta de HU-013. BL-163 la crea
   * permanente para el usuario técnico del comensal (el backend se loguea
   * con ella por password grant) y para las contraseñas fijas de los
   * establecimientos de prueba.
   */
  temporary?: boolean;
}

/** Usuario de Keycloak tal como lo devuelve la Admin API (campos usados). */
export interface KeycloakUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  attributes?: Record<string, string[]>;
}

/** BL-163: datos del perfil que exige el realm (email, nombre y apellido). */
export interface PerfilKeycloak {
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Encapsula la Admin REST API de Keycloak. Usa el service account del cliente
 * bistrolink-backend (grant_type=client_credentials) — requiere que ese
 * cliente tenga asignados los roles manage-users/view-users/query-users/
 * view-realm del cliente realm-management (ver BL-162: estos roles están
 * declarados en keycloak/realm-export.json, no dependen de un script manual).
 *
 * Toda falla de la Admin API se loguea acá explícitamente (this.logger.error)
 * ANTES de lanzar la excepción. Motivo (BL-163): NestJS no garantiza que el
 * mensaje/stack de una excepción no capturada llegue con detalle a Grafana
 * Loki — lo que sí llega es el wrapper genérico de pino-http
 * ("failed with status code 500"), sin el status real de Keycloak ni el
 * body de su respuesta. Sin este logging explícito, un 403 (permisos) y un
 * 404 (recurso inexistente) son indistinguibles en producción.
 */
@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name);

  // Se leen de forma perezosa (no a nivel de módulo) para que el archivo se
  // pueda importar y la clase se pueda instanciar sin que exista todavía
  // KEYCLOAK_CLIENT_SECRET — por ejemplo desde un TestingModule de Nest en
  // tests unitarios que no llegan a invocar ningún método real. El error
  // solo se lanza si efectivamente se intenta pedir un token de admin sin
  // el secreto configurado.
  private get keycloakUrl(): string {
    return process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
  }

  private get realm(): string {
    return process.env.KEYCLOAK_REALM ?? 'bistrolink';
  }

  private get clientId(): string {
    return process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
  }

  private get clientSecret(): string {
    const secret = process.env.KEYCLOAK_CLIENT_SECRET;
    if (!secret) {
      throw new Error(
        'Falta KEYCLOAK_CLIENT_SECRET en el .env — KeycloakAdminService no puede autenticarse sin esto.',
      );
    }
    return secret;
  }

  /** Arma un mensaje de diagnóstico consistente y lo loguea antes de lanzarlo. */
  private logAndBuildError(
    context: string,
    status: number,
    body: string,
  ): string {
    const detalle = `${context} (status ${status}): ${body}`;
    this.logger.error(detalle);
    return detalle;
  }

  private async getAdminToken(): Promise<string> {
    const res = await fetch(
      `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      this.logAndBuildError(
        'No se pudo obtener token de administración de Keycloak',
        res.status,
        body,
      );
      if (res.status === 401) {
        throw new InternalServerErrorException(
          'Credenciales del service account rechazadas por Keycloak (401). Verificá KEYCLOAK_CLIENT_ID/KEYCLOAK_CLIENT_SECRET y que coincidan con el client real en el realm configurado.',
        );
      }
      throw new InternalServerErrorException(
        `No se pudo obtener token de administración de Keycloak: ${res.status} ${body}`,
      );
    }
    const data = await res.json();
    return data.access_token as string;
  }

  private async adminFetch(path: string, init: RequestInit = {}) {
    const token = await this.getAdminToken();
    const res = await fetch(
      `${this.keycloakUrl}/admin/realms/${this.realm}${path}`,
      {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );
    return res;
  }

  /**
   * Crea el usuario en Keycloak, con tenant_id ya seteado y contraseña
   * temporal. Sin tenantId solo para usuarios de plataforma (BL-163).
   */
  async createUser(payload: KeycloakUserPayload): Promise<string> {
    const res = await this.adminFetch('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: payload.username,
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        enabled: true,
        emailVerified: true,
        ...(payload.tenantId
          ? { attributes: { tenant_id: [payload.tenantId] } }
          : {}),
        ...(payload.requiredActions
          ? { requiredActions: payload.requiredActions }
          : {}),
        credentials: [
          {
            type: 'password',
            value: payload.temporaryPassword,
            temporary: payload.temporary ?? true,
          },
        ],
      }),
    });

    if (res.status !== 201) {
      const body = await res.text();
      if (res.status === 409) {
        // Keycloak devuelve 409 cuando el username o el email ya existen en
        // el realm — es un conflicto esperable (no un error de servidor), y
        // el frontend necesita poder distinguirlo para mostrar un mensaje
        // útil en vez de un 500 genérico. Se loguea a nivel warn, no error:
        // no es una falla del sistema, es un intento inválido del usuario.
        //
        // [S] No se loguea el username/email acá a propósito (RD.07):
        // el audit-log de este mismo módulo tampoco lo hace (ver
        // AuditAction.USUARIO_CREADO en usuarios.service.ts, que solo
        // audita rol/restauranteId), y Grafana Loki tiene un círculo de
        // acceso más amplio que Postgres. El status/body de Keycloak ya
        // alcanza para diagnosticar sin exponer el dato.
        this.logger.warn(
          `Intento de crear un usuario que ya existe en Keycloak (409): ${body}`,
        );
        throw new ConflictException(
          'Ya existe un usuario con ese nombre de usuario o email',
        );
      }
      if (res.status === 403) {
        this.logAndBuildError(
          'Sin permiso para crear usuario en Keycloak',
          res.status,
          body,
        );
        throw new InternalServerErrorException(
          "El service account no tiene permiso para crear usuarios (403). Verificá que 'manage-users' esté asignado en realm-export.json.",
        );
      }
      this.logAndBuildError(
        'No se pudo crear el usuario en Keycloak',
        res.status,
        body,
      );
      throw new InternalServerErrorException(
        `No se pudo crear el usuario en Keycloak: ${res.status} ${body}`,
      );
    }

    const location = res.headers.get('Location');
    const keycloakId = location?.split('/').pop();
    if (!keycloakId) {
      this.logger.error(
        'Keycloak devolvió 201 al crear un usuario pero sin header Location — no se pudo extraer el keycloakId.',
      );
      throw new InternalServerErrorException(
        'Keycloak no devolvió el ID del usuario creado',
      );
    }
    return keycloakId;
  }

  /**
   * BL-163: busca un usuario por username exacto. Devuelve null si no existe.
   * La respuesta incluye los atributos (tenant_id), que el alta de
   * establecimiento usa para no "adoptar" un usuario de otro tenant.
   *
   * [S] El username no va en el log de error (mismo criterio que createUser).
   */
  async findUserByUsername(username: string): Promise<KeycloakUser | null> {
    const res = await this.adminFetch(
      `/users?username=${encodeURIComponent(username)}&exact=true`,
    );
    if (!res.ok) {
      const body = await res.text();
      this.logAndBuildError(
        'No se pudo buscar un usuario en Keycloak',
        res.status,
        body,
      );
      throw new InternalServerErrorException(
        `No se pudo buscar el usuario en Keycloak: ${res.status} ${body}`,
      );
    }
    const usuarios = (await res.json()) as KeycloakUser[];
    return usuarios[0] ?? null;
  }

  /**
   * BL-163: busca un usuario por su id (el `sub` de su token). Devuelve null
   * si no existe. El alta de establecimientos lo usa para guardar el username
   * de quien la hizo: el token no siempre trae `preferred_username` (depende
   * de que el realm tenga el client scope `profile`).
   */
  async findUserById(keycloakId: string): Promise<KeycloakUser | null> {
    const res = await this.adminFetch(
      `/users/${encodeURIComponent(keycloakId)}`,
    );
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      const body = await res.text();
      this.logAndBuildError(
        `No se pudo leer el usuario ${keycloakId} en Keycloak`,
        res.status,
        body,
      );
      throw new InternalServerErrorException(
        `No se pudo leer el usuario en Keycloak: ${res.status} ${body}`,
      );
    }
    return (await res.json()) as KeycloakUser;
  }

  /**
   * BL-163: completa el email, el nombre y el apellido de un usuario que no
   * los tiene (por ejemplo, uno creado antes de que el alta los mandara).
   * Solo llena los que faltan: nunca pisa un valor que ya existe. Devuelve
   * si tuvo que cambiar algo.
   *
   * Lee el usuario completo y lo vuelve a mandar entero con los datos
   * agregados, así el PUT no puede borrar atributos como tenant_id.
   */
  async completarPerfil(
    keycloakId: string,
    perfil: PerfilKeycloak,
  ): Promise<boolean> {
    const getRes = await this.adminFetch(`/users/${keycloakId}`);
    if (!getRes.ok) {
      const body = await getRes.text();
      this.logAndBuildError(
        `No se pudo leer el usuario ${keycloakId} en Keycloak para completar su perfil`,
        getRes.status,
        body,
      );
      throw new InternalServerErrorException(
        `No se pudo leer el usuario en Keycloak: ${getRes.status} ${body}`,
      );
    }
    const usuario = (await getRes.json()) as Record<string, unknown>;

    const faltantes: Partial<PerfilKeycloak> = {};
    for (const campo of ['email', 'firstName', 'lastName'] as const) {
      if (!usuario[campo]) {
        faltantes[campo] = perfil[campo];
      }
    }
    if (Object.keys(faltantes).length === 0) {
      return false;
    }

    const res = await this.adminFetch(`/users/${keycloakId}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...usuario,
        ...faltantes,
        ...(faltantes.email ? { emailVerified: true } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      this.logAndBuildError(
        `No se pudo completar el perfil del usuario ${keycloakId} en Keycloak`,
        res.status,
        body,
      );
      throw new InternalServerErrorException(
        `No se pudo completar el perfil del usuario en Keycloak: ${res.status} ${body}`,
      );
    }
    return true;
  }

  /** Asigna un rol de Realm (ADMIN, MOZO, COCINA, COMENSAL) a un usuario. */
  async assignRealmRole(keycloakId: string, roleName: string): Promise<void> {
    const roleRes = await this.adminFetch(`/roles/${roleName}`);
    if (!roleRes.ok) {
      const body = await roleRes.text();
      this.logAndBuildError(
        `No se pudo consultar el rol de Realm '${roleName}'`,
        roleRes.status,
        body,
      );
      if (roleRes.status === 404) {
        throw new InternalServerErrorException(
          `El rol de Realm '${roleName}' no existe en Keycloak (404). Verificá que esté declarado en la sección "roles" de realm-export.json.`,
        );
      }
      if (roleRes.status === 403) {
        throw new InternalServerErrorException(
          `El service account no tiene permiso para consultar el rol '${roleName}' (403). Verificá que 'view-realm' esté asignado en realm-export.json (ver BL-162).`,
        );
      }
      throw new InternalServerErrorException(
        `No se pudo consultar el rol de Realm '${roleName}' en Keycloak: ${roleRes.status} ${body}`,
      );
    }
    const role = await roleRes.json();

    const res = await this.adminFetch(
      `/users/${keycloakId}/role-mappings/realm`,
      {
        method: 'POST',
        body: JSON.stringify([{ id: role.id, name: role.name }]),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      this.logAndBuildError(
        `No se pudo asignar el rol '${roleName}' al usuario ${keycloakId}`,
        res.status,
        body,
      );
      throw new InternalServerErrorException(
        `No se pudo asignar el rol '${roleName}': ${res.status} ${body}`,
      );
    }
  }

  /** Habilita/deshabilita el login del usuario (usado para "desactivar" una cuenta). */
  async setEnabled(keycloakId: string, enabled: boolean): Promise<void> {
    const res = await this.adminFetch(`/users/${keycloakId}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      const body = await res.text();
      this.logAndBuildError(
        `No se pudo ${enabled ? 'activar' : 'desactivar'} el usuario ${keycloakId} en Keycloak`,
        res.status,
        body,
      );
      throw new InternalServerErrorException(
        `No se pudo ${enabled ? 'activar' : 'desactivar'} el usuario en Keycloak: ${res.status} ${body}`,
      );
    }
  }

  /**
   * BL-272: cierra todas las sesiones del usuario en Keycloak y revoca sus
   * refresh tokens (POST /users/{id}/logout, requiere manage-users).
   *
   * Se usa después de desactivar una cuenta: setEnabled(false) solo impide
   * los logins nuevos. Las sesiones abiertas seguían vivas y, si la cuenta
   * se volvía a activar, el refresh token viejo volvía a servir.
   *
   * No lanza: si falla, la desactivación ya quedó hecha y el access token
   * vigente vence solo (accessTokenLifespan de 15 min, BL-266). Devuelve si
   * pudo cerrarlas, para dejarlo registrado en el audit log.
   */
  async logoutUser(keycloakId: string): Promise<boolean> {
    try {
      const res = await this.adminFetch(`/users/${keycloakId}/logout`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.text();
        this.logAndBuildError(
          `No se pudieron cerrar las sesiones del usuario ${keycloakId} en Keycloak (queda desactivado; su access token vence solo)`,
          res.status,
          body,
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(
        `No se pudieron cerrar las sesiones del usuario ${keycloakId} en Keycloak (queda desactivado; su access token vence solo): ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Elimina el usuario en Keycloak. Se usa como compensación: si algo falla
   * después de crear la identidad (asignar el rol, o persistir la fila en
   * Postgres), UsuariosService.crear() llama a esto para no dejar un usuario
   * huérfano en Keycloak sin fila correspondiente en la base.
   */
  async deleteUser(keycloakId: string): Promise<void> {
    const res = await this.adminFetch(`/users/${keycloakId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.text();
      // [S] Log a nivel error: si esto falla, queda un usuario huérfano en
      // Keycloak que requiere limpieza manual (ver comentario en
      // usuarios.service.ts::crear()) — necesitamos poder encontrarlo en
      // Loki filtrando por keycloakId.
      this.logAndBuildError(
        `No se pudo eliminar el usuario ${keycloakId} en Keycloak (limpieza de compensación)`,
        res.status,
        body,
      );
      throw new InternalServerErrorException(
        `No se pudo eliminar el usuario en Keycloak: ${res.status} ${body}`,
      );
    }
  }
}
