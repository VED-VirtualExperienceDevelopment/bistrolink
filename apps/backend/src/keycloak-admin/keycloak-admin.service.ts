import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET;
if (!CLIENT_SECRET) {
  throw new Error(
    'Falta KEYCLOAK_CLIENT_SECRET en el .env — KeycloakAdminService no puede autenticarse sin esto.',
  );
}

export interface KeycloakUserPayload {
  username: string;
  email?: string;
  tenantId: string;
  temporaryPassword: string;
}

/**
 * Encapsula la Admin REST API de Keycloak. Usa el service account del cliente
 * bistrolink-backend (grant_type=client_credentials) — requiere que ese
 * cliente tenga asignados los roles manage-users/view-users/query-users del
 * cliente realm-management (ver Service account roles en la consola).
 */
@Injectable()
export class KeycloakAdminService {
  private async getAdminToken(): Promise<string> {
    const res = await fetch(
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      },
    );
    if (!res.ok) {
      throw new InternalServerErrorException(
        `No se pudo obtener token de administración de Keycloak: ${res.status} ${await res.text()}`,
      );
    }
    const data = await res.json();
    return data.access_token as string;
  }

  private async adminFetch(path: string, init: RequestInit = {}) {
    const token = await this.getAdminToken();
    const res = await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    return res;
  }

  /** Crea el usuario en Keycloak, con tenant_id ya seteado y contraseña temporal. */
  async createUser(payload: KeycloakUserPayload): Promise<string> {
    const res = await this.adminFetch('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: payload.username,
        email: payload.email,
        enabled: true,
        emailVerified: true,
        attributes: { tenant_id: [payload.tenantId] },
        credentials: [
          {
            type: 'password',
            value: payload.temporaryPassword,
            temporary: true,
          },
        ],
      }),
    });

    if (res.status !== 201) {
      if (res.status === 409) {
        // Keycloak devuelve 409 cuando el username o el email ya existen en
        // el realm — es un conflicto esperable (no un error de servidor), y
        // el frontend necesita poder distinguirlo para mostrar un mensaje
        // útil en vez de un 500 genérico.
        throw new ConflictException(
          'Ya existe un usuario con ese nombre de usuario o email',
        );
      }
      throw new InternalServerErrorException(
        `No se pudo crear el usuario en Keycloak: ${res.status} ${await res.text()}`,
      );
    }

    const location = res.headers.get('Location');
    const keycloakId = location?.split('/').pop();
    if (!keycloakId) {
      throw new InternalServerErrorException(
        'Keycloak no devolvió el ID del usuario creado',
      );
    }
    return keycloakId;
  }

  /** Asigna un rol de Realm (ADMIN, MOZO, COCINA, COMENSAL) a un usuario. */
  async assignRealmRole(keycloakId: string, roleName: string): Promise<void> {
    const roleRes = await this.adminFetch(`/roles/${roleName}`);
    if (!roleRes.ok) {
      throw new InternalServerErrorException(
        `No se encontró el rol de Realm '${roleName}' en Keycloak`,
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
      throw new InternalServerErrorException(
        `No se pudo asignar el rol '${roleName}': ${res.status} ${await res.text()}`,
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
      throw new InternalServerErrorException(
        `No se pudo ${enabled ? 'activar' : 'desactivar'} el usuario en Keycloak: ${res.status} ${await res.text()}`,
      );
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
      throw new InternalServerErrorException(
        `No se pudo eliminar el usuario en Keycloak: ${res.status} ${await res.text()}`,
      );
    }
  }
}
