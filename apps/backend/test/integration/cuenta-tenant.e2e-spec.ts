import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';

// BL-265 (BL-262, hallazgo R1): un usuario no puede cambiarse de tenant.
//
// El tenant de cada usuario vive en el atributo `tenant_id` de Keycloak, y el
// mapper `tenant-id-mapper` lo copia al JWT. Si el propio usuario pudiera
// editarlo desde su cuenta (account-console / Account REST API), su próximo
// token saldría con otro tenant y RLS le daría acceso a datos ajenos (RD.07).
//
// La corrección (BL-263) dejó `tenant_id` con view/edit solo para `admin` en
// el user profile del realm. Estos tests hacen el ataque real contra el
// Keycloak local y verifican que el tenant no cambia: si alguien vuelve a
// abrir el permiso, fallan.
//
// Verificado contra Keycloak 26.7.2 el 03/10/2026: con el permiso abierto a
// `user`, el POST a /account devuelve 204 y el tenant cambia; con la
// corrección, devuelve 400 (`error-user-attribute-read-only`).

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';

const TENANT_A = '554915d0-f7ed-4053-b841-56479df29fd9'; // tenant Ejemplo
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';

// Tenant Demo: el único con mesa cargada en el seed (mismo fixture que
// kds.e2e-spec.ts), necesario para pedir un token de comensal.
const TENANT_DEMO = '11111111-1111-1111-1111-111111111111';
const MESA_DEMO = '33333333-3333-3333-3333-333333333333';

const ACCOUNT_URL = `${KEYCLOAK_URL}/realms/${REALM}/account`;

// Token de admin de MASTER, mismo criterio que usuarios.e2e-spec.ts.
async function getMasterAdminToken(): Promise<string> {
  const adminUser =
    process.env.KC_BOOTSTRAP_ADMIN_USERNAME ??
    process.env.KEYCLOAK_ADMIN ??
    'admin';
  const adminPass =
    process.env.KC_BOOTSTRAP_ADMIN_PASSWORD ??
    process.env.KEYCLOAK_ADMIN_PASSWORD ??
    'admin';
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: adminUser,
        password: adminPass,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`No se pudo obtener token de admin master: ${res.status}`);
  }
  return (await res.json()).access_token as string;
}

async function adminHeaders(): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await getMasterAdminToken()}`,
    'Content-Type': 'application/json',
  };
}

// Lee el tenant_id de un usuario con la Admin API (la fuente de verdad).
async function tenantIdEnKeycloak(keycloakId: string): Promise<string[]> {
  const res = await fetch(
    `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakId}`,
    { headers: await adminHeaders() },
  );
  const usuario = await res.json();
  return usuario.attributes?.tenant_id ?? [];
}

function claims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

// Token del usuario para el cliente `account-console`, obtenido igual que lo
// hace el navegador al entrar a /realms/bistrolink/account: authorization
// code con PKCE. Hace falta este cliente porque la Account API solo acepta
// tokens con audiencia `account`; un token de `bistrolink-backend` recibe 401.
async function tokenDeAccountConsole(
  username: string,
  password: string,
): Promise<string> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = `${ACCOUNT_URL}/`;

  // 1. Pantalla de login (guarda las cookies de la sesión de autenticación).
  const login = await fetch(
    `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/auth?` +
      new URLSearchParams({
        client_id: 'account-console',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }),
    { redirect: 'manual' },
  );
  const cookies = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const html = await login.text();
  const action = html
    .match(/<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/)?.[1]
    ?.replace(/&amp;/g, '&');
  if (!action) {
    throw new Error(`No se encontró el formulario de login (${login.status})`);
  }

  // 2. Envío de usuario y contraseña: Keycloak redirige con el code.
  const envio = await fetch(action, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: cookies,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ username, password, credentialId: '' }),
  });
  const location = envio.headers.get('location');
  const code = location ? new URL(location).searchParams.get('code') : null;
  if (!code) {
    throw new Error(`Login fallido para ${username}: ${envio.status}`);
  }

  // 3. Canje del code por el token.
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'account-console',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`No se pudo canjear el code: ${res.status}`);
  }
  return (await res.json()).access_token as string;
}

// Token de bistrolink-backend (el que usa la app), para ver qué tenant_id
// saldría en el próximo login.
async function tokenDeBackend(
  username: string,
  password: string,
): Promise<string> {
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend',
        client_secret: process.env.KEYCLOAK_CLIENT_SECRET ?? '',
        username,
        password,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`No se pudo obtener token para ${username}: ${res.status}`);
  }
  return (await res.json()).access_token as string;
}

describe('Tenant del usuario no editable por la API de cuenta (BL-265, R1)', () => {
  // Usuario temporal creado por la Admin API, como los que crea /usuarios
  // (HU-013) o el aprovisionamiento (HU-027). Además se le asignan a mano
  // los roles `account/view-profile` y `account/manage-account`, para que el
  // ataque llegue hasta el control de R1 donde el realm lo permite.
  //
  // Ojo: no en todos los realms el usuario llega a su cuenta. En realms
  // importados antes de Keycloak 26 (como algunos locales), el cliente
  // `account-console` quedó sin scopes por defecto: su token no lleva los
  // roles de cuenta y la Account API responde 403 antes de mirar el user
  // profile. Por eso el test verifica dos cosas que valen en cualquier
  // realm: la configuración del atributo (Admin API) y el resultado del
  // ataque (el tenant no cambia), sin exigir que la cuenta sea accesible.
  const username = `r1-test-${Date.now()}`;
  const password = `R1-${randomBytes(9).toString('base64url')}`;
  let keycloakId: string;

  beforeAll(async () => {
    const res = await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}/users`, {
      method: 'POST',
      headers: await adminHeaders(),
      body: JSON.stringify({
        username,
        email: `${username}@bistrolink.dev.com`,
        firstName: 'R1',
        lastName: 'Test',
        enabled: true,
        emailVerified: true,
        attributes: { tenant_id: [TENANT_A] },
        credentials: [{ type: 'password', value: password, temporary: false }],
      }),
    });
    if (res.status !== 201) {
      throw new Error(`No se pudo crear el usuario de prueba: ${res.status}`);
    }
    keycloakId = (res.headers.get('location') as string).split('/').pop()!;

    const headers = await adminHeaders();
    const clientes = await (
      await fetch(
        `${KEYCLOAK_URL}/admin/realms/${REALM}/clients?clientId=account`,
        { headers },
      )
    ).json();
    const accountId = clientes[0].id as string;
    const roles = await Promise.all(
      ['view-profile', 'manage-account'].map(async (rol) =>
        (
          await fetch(
            `${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${accountId}/roles/${rol}`,
            { headers },
          )
        ).json(),
      ),
    );
    await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakId}/role-mappings/clients/${accountId}`,
      { method: 'POST', headers, body: JSON.stringify(roles) },
    );
  });

  afterAll(async () => {
    if (keycloakId) {
      await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakId}`, {
        method: 'DELETE',
        headers: await adminHeaders(),
      }).catch(() => undefined); // best-effort
    }
  });

  it('[TC-I-043] Keycloak: un usuario no puede cambiar su tenant_id desde la API de cuenta', async () => {
    const token = await tokenDeAccountConsole(username, password);

    // 1. Configuración (vale en cualquier realm): tenant_id visible y
    //    editable solo por admin en el user profile.
    const perfil = await (
      await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}/users/profile`, {
        headers: await adminHeaders(),
      })
    ).json();
    const atributo = (
      perfil.attributes as { name: string; permissions: unknown }[]
    ).find((a) => a.name === 'tenant_id');
    expect(atributo?.permissions).toEqual({
      view: ['admin'],
      edit: ['admin'],
    });

    // 2. Ataque real. Si la cuenta es accesible (200), no tiene que mostrar
    //    el tenant; si el realm la bloquea antes (403), el ataque sigue igual
    //    y se verifica el resultado.
    const cuenta = await fetch(ACCOUNT_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    expect([200, 403]).toContain(cuenta.status);
    const representacion = cuenta.ok ? await cuenta.json() : { username };
    expect(representacion.attributes?.tenant_id).toBeUndefined();

    // Intento de cambio de tenant: Keycloak 26 responde 400
    // (error-user-attribute-read-only), o 403 si la cuenta no es accesible.
    // Lo que importa es el resultado: el tenant no cambia ni en Keycloak ni
    // en el próximo token.
    await fetch(ACCOUNT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        ...representacion,
        attributes: {
          ...(representacion.attributes ?? {}),
          tenant_id: [TENANT_B],
        },
      }),
    });

    expect(await tenantIdEnKeycloak(keycloakId)).toEqual([TENANT_A]);
    const tokenNuevo = await tokenDeBackend(username, password);
    expect(claims(tokenNuevo).tenant_id).toBe(TENANT_A);
  });
});

describe('Token de comensal contra la API de cuenta (BL-265, R1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('[TC-I-044] Keycloak: el token anónimo de comensal no puede cambiar el tenant por la API de cuenta', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/comensal')
      .send({ tenantId: TENANT_DEMO, mesaId: MESA_DEMO })
      .expect(200);
    const token = res.body.accessToken as string;

    // El token de comensal sale de bistrolink-backend: la Account API lo
    // rechaza (sin audiencia `account`), así que ni siquiera puede leer la
    // cuenta, y menos modificarla.
    const lectura = await fetch(ACCOUNT_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    expect([401, 403]).toContain(lectura.status);

    const intento = await fetch(ACCOUNT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ attributes: { tenant_id: [TENANT_B] } }),
    });
    expect([401, 403]).toContain(intento.status);

    // El usuario técnico del comensal sigue en su tenant.
    expect(await tenantIdEnKeycloak(claims(token).sub as string)).toEqual([
      TENANT_DEMO,
    ]);
  });
});
