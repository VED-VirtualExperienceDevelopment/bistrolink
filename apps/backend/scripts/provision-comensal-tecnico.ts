import 'dotenv/config';

const [, , tenantId] = process.argv;

if (!tenantId) {
  console.error(
    'Uso: npx ts-node scripts/provision-comensal-tecnico.ts <tenantId>',
  );
  process.exit(1);
}

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET;
const COMENSAL_PASSWORD = process.env.KEYCLOAK_COMENSAL_PASSWORD;

if (!CLIENT_SECRET) {
  console.error('Falta KEYCLOAK_CLIENT_SECRET en el .env');
  process.exit(1);
}
if (!COMENSAL_PASSWORD) {
  console.error('Falta KEYCLOAK_COMENSAL_PASSWORD en el .env');
  process.exit(1);
}

const username = `comensal-${tenantId}`;

async function getAdminToken(): Promise<string> {
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET as string,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `No se pudo autenticar contra Keycloak: ${res.status} ${await res.text()}`,
    );
  }
  const data = await res.json();
  return data.access_token as string;
}

async function main() {
  const adminToken = await getAdminToken();
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
  };

  const buscar = await fetch(
    `${KEYCLOAK_URL}/admin/realms/${REALM}/users?username=${username}&exact=true`,
    { headers },
  );
  const existentes = await buscar.json();

  let keycloakId: string;

  if (existentes.length > 0) {
    keycloakId = existentes[0].id;
    await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        attributes: { tenant_id: [tenantId] },
      }),
    });
    console.log(
      `ℹ️  El usuario "${username}" ya existía (${keycloakId}) — atributos actualizados.`,
    );
  } else {
    const crear = await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username,
        email: `${username}@tecnico.bistrolink.local`, //dominio ficticio, nunca se usa para enviar nada
        firstName: 'Comensal',
        lastName: 'Técnico',
        enabled: true,
        emailVerified: true,
        requiredActions: [],
        attributes: { tenant_id: [tenantId] },
        credentials: [
          { type: 'password', value: COMENSAL_PASSWORD, temporary: false },
        ],
      }),
    });
    if (crear.status !== 201) {
      throw new Error(
        `No se pudo crear el usuario: ${crear.status} ${await crear.text()}`,
      );
    }
    keycloakId = crear.headers.get('Location')!.split('/').pop()!;
    console.log(`✅ Usuario "${username}" creado (${keycloakId}).`);
  }

  const rolRes = await fetch(
    `${KEYCLOAK_URL}/admin/realms/${REALM}/roles/COMENSAL`,
    { headers },
  );
  const rol = await rolRes.json();
  await fetch(
    `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakId}/role-mappings/realm`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify([{ id: rol.id, name: rol.name }]),
    },
  );

  console.log(
    `✅ Rol COMENSAL asignado. Usuario técnico listo para el tenant ${tenantId}.`,
  );
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
