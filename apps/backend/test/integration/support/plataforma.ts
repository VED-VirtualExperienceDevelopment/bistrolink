import { digitoVerificadorRut } from '../../../src/plataforma/rut';

/**
 * BL-416: ayudas compartidas por los tests de integración de la plataforma
 * (plataforma.e2e-spec.ts y plataforma-gestion.e2e-spec.ts): tokens de
 * Keycloak, la API de administración del realm y el RUT de prueba.
 */

export const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
export const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

/** Token por password grant. Lanza si Keycloak no lo da. */
export async function pedirToken(
  username: string,
  password: string,
): Promise<string> {
  const res = await intentarToken(username, password);
  if (!res.ok) {
    throw new Error(
      `No se pudo obtener token para ${username}: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()).access_token as string;
}

/** La respuesta cruda del password grant (para probar que falla). */
export function intentarToken(
  username: string,
  password: string,
): Promise<Response> {
  return fetch(
    `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        username,
        password,
      }),
    },
  );
}

export function claims(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  );
}

// Mismo token de admin de master que usuarios.e2e-spec.ts.
async function getMasterAdminToken(): Promise<string> {
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username:
          process.env.KC_BOOTSTRAP_ADMIN_USERNAME ??
          process.env.KEYCLOAK_ADMIN ??
          'admin',
        password:
          process.env.KC_BOOTSTRAP_ADMIN_PASSWORD ??
          process.env.KEYCLOAK_ADMIN_PASSWORD ??
          'admin',
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`No se pudo obtener token de admin master: ${res.status}`);
  }
  return (await res.json()).access_token as string;
}

/** Llamada a la API de administración del realm, con el admin de master. */
export async function adminKeycloak(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await getMasterAdminToken()}`,
      'Content-Type': 'application/json',
    },
  });
}

export interface UsuarioKeycloakTest {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export async function buscarUsuarioKeycloak(
  username: string,
): Promise<UsuarioKeycloakTest | undefined> {
  const res = await adminKeycloak(
    `/users?username=${encodeURIComponent(username)}&exact=true`,
  );
  const usuarios = (await res.json()) as UsuarioKeycloakTest[];
  return usuarios[0];
}

/** Atributo tenant_id de un usuario de Keycloak, o undefined. */
export async function tenantIdEnKeycloak(
  username: string,
): Promise<string | undefined> {
  const usuario = await buscarUsuarioKeycloak(username);
  if (!usuario) return undefined;
  const res = await adminKeycloak(`/users/${usuario.id}`);
  const completo = (await res.json()) as {
    attributes?: Record<string, string[]>;
  };
  return completo.attributes?.tenant_id?.[0];
}

export async function rolesKeycloak(keycloakId: string): Promise<string[]> {
  const res = await adminKeycloak(`/users/${keycloakId}/role-mappings/realm`);
  return ((await res.json()) as { name: string }[]).map((r) => r.name);
}

export async function borrarUsuarioKeycloak(username: string): Promise<void> {
  const usuario = await buscarUsuarioKeycloak(username);
  if (usuario) {
    await adminKeycloak(`/users/${usuario.id}`, { method: 'DELETE' });
  }
}

/**
 * Le pone una contraseña definitiva a un usuario del test (las del alta son
 * temporales y Keycloak no da token hasta cambiarlas) y le saca las acciones
 * pendientes.
 */
export async function fijarContrasena(
  username: string,
  password: string,
): Promise<void> {
  const usuario = await buscarUsuarioKeycloak(username);
  if (!usuario) throw new Error(`No existe ${username} en Keycloak`);
  await adminKeycloak(`/users/${usuario.id}/reset-password`, {
    method: 'PUT',
    body: JSON.stringify({
      type: 'password',
      value: password,
      temporary: false,
    }),
  });
  await adminKeycloak(`/users/${usuario.id}`, {
    method: 'PUT',
    body: JSON.stringify({ requiredActions: [] }),
  });
}

/**
 * Crea un usuario PLATAFORMA del test (sin tenant_id y sin OTP: el OTP es
 * del login en el navegador y el test pide el token por password grant) y
 * devuelve su token. Lanza si el realm no tiene el rol PLATAFORMA.
 */
export async function crearUsuarioPlataforma(
  username: string,
  password: string,
): Promise<string> {
  const rol = await adminKeycloak('/roles/PLATAFORMA');
  if (!rol.ok) {
    throw new Error(
      'Falta el rol PLATAFORMA en el realm (ver keycloak/realm-export.json).',
    );
  }
  const creado = await adminKeycloak('/users', {
    method: 'POST',
    body: JSON.stringify({
      username,
      email: `${username}@prueba.bistrolink.local`,
      firstName: 'Plataforma',
      lastName: 'Prueba',
      enabled: true,
      emailVerified: true,
      credentials: [{ type: 'password', value: password, temporary: false }],
    }),
  });
  if (creado.status !== 201) {
    throw new Error(
      `No se pudo crear el usuario PLATAFORMA del test: ${creado.status}`,
    );
  }
  const keycloakId = (creado.headers.get('location') as string)
    .split('/')
    .pop();
  await adminKeycloak(`/users/${keycloakId}/role-mappings/realm`, {
    method: 'POST',
    body: JSON.stringify([await rol.json()]),
  });
  return pedirToken(username, password);
}

/**
 * BL-409: RUT válido para la corrida. Registro 21, seis dígitos tomados de
 * `semilla`, `001` y el verificador. Si con esos dígitos no hay verificador
 * posible (da 10), prueba con el número siguiente.
 */
export function rutDePrueba(semilla: string): string {
  const inicial = Number(semilla.slice(-6));
  for (let intento = 0; intento < 20; intento++) {
    const numero = String((inicial + intento) % 1_000_000).padStart(6, '0');
    if (numero === '000000') continue;
    const base = `21${numero}001`;
    const digito = digitoVerificadorRut(base);
    if (digito !== null) return `${base}${digito}`;
  }
  throw new Error('No se pudo armar un RUT de prueba válido');
}

/** El mismo RUT con otro dígito verificador (inválido). */
export function rutConVerificadorIncorrecto(rut: string): string {
  const digito = (Number(rut[11]) + 1) % 10;
  return `${rut.slice(0, 11)}${digito}`;
}
