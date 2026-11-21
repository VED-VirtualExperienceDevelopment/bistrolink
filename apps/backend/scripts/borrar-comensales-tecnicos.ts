import 'dotenv/config';
import {
  comensalesTecnicosABorrar,
  type UsuarioConRoles,
} from '../src/plataforma/comensales-tecnicos';

/**
 * BL-581: borra de Keycloak los usuarios técnicos del comensal que quedaron
 * de antes de HU-052 (uno por establecimiento).
 *
 * Antes de correrlo con --aplicar en un entorno, la API de ese entorno
 * tiene que estar corriendo una versión con BL-581: desde ahí el comensal
 * entra solo con el token de invitado, y estos usuarios no los usa nadie.
 * Con una versión anterior y COMENSAL_TOKEN_EMISOR=keycloak, borrarlos deja
 * a todos los locales sin carta.
 *
 * - Sin opciones: muestra qué borraría, sin cambiar nada.
 * - Con --aplicar: los borra.
 *
 * Solo borra usuarios con el rol COMENSAL, nombre `comensal-…` y ningún rol
 * del personal (src/plataforma/comensales-tecnicos.ts). Los demás que
 * tengan el rol COMENSAL se listan para revisarlos a mano. Los nombres no se
 * muestran (en staging no se pueden adivinar, BL-271): se identifican por
 * el tenant.
 *
 * Uso (desde apps/backend), con las variables en la sesión, nunca en un
 * archivo del repo:
 *
 *   KEYCLOAK_URL, KEYCLOAK_REALM (bistrolink), KEYCLOAK_CLIENT_ID
 *   (bistrolink-backend) y KEYCLOAK_CLIENT_SECRET
 *
 *   npx ts-node scripts/borrar-comensales-tecnicos.ts
 *   npx ts-node scripts/borrar-comensales-tecnicos.ts --aplicar
 *
 * Se puede correr las veces que haga falta: si no queda ninguno, no hace nada.
 */

const APLICAR = process.argv.includes('--aplicar');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

if (!CLIENT_SECRET) {
  console.error('Falta KEYCLOAK_CLIENT_SECRET');
  process.exit(1);
}

const ADMIN = `${KEYCLOAK_URL}/admin/realms/${REALM}`;

interface UsuarioKeycloak {
  id: string;
  username: string;
  attributes?: Record<string, string[]>;
}

async function tokenDeServicio(): Promise<string> {
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
    throw new Error(`No se pudo autenticar contra Keycloak: ${res.status}`);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Usuarios con el rol COMENSAL, de a 100, con sus roles de realm. */
async function usuariosConRolComensal(
  headers: Record<string, string>,
): Promise<UsuarioConRoles[]> {
  const usuarios: UsuarioKeycloak[] = [];
  for (let first = 0; ; first += 100) {
    const res = await fetch(
      `${ADMIN}/roles/COMENSAL/users?briefRepresentation=false&first=${first}&max=100`,
      { headers },
    );
    if (res.status === 404) return []; // el rol no existe: nada que borrar
    if (!res.ok) throw new Error(`No se pudo listar usuarios: ${res.status}`);
    const pagina = (await res.json()) as UsuarioKeycloak[];
    usuarios.push(...pagina);
    if (pagina.length < 100) break;
  }

  const conRoles: UsuarioConRoles[] = [];
  for (const usuario of usuarios) {
    const res = await fetch(
      `${ADMIN}/users/${usuario.id}/role-mappings/realm`,
      {
        headers,
      },
    );
    if (!res.ok) {
      throw new Error(
        `No se pudieron leer los roles de un usuario: ${res.status}`,
      );
    }
    const roles = ((await res.json()) as { name: string }[]).map((r) => r.name);
    conRoles.push({
      id: usuario.id,
      username: usuario.username,
      tenantId: usuario.attributes?.tenant_id?.[0],
      roles,
    });
  }
  return conRoles;
}

function etiqueta(usuario: UsuarioConRoles): string {
  return `tenant ${usuario.tenantId ?? '(sin tenant_id)'} (id ${usuario.id})`;
}

async function main() {
  const token = await tokenDeServicio();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const { borrar, revisarAMano } = comensalesTecnicosABorrar(
    await usuariosConRolComensal(headers),
  );
  console.log(
    `Keycloak ${KEYCLOAK_URL}, realm ${REALM}: ${borrar.length} comensales técnicos para borrar.`,
  );

  for (const usuario of revisarAMano) {
    console.warn(
      `⚠️  ${etiqueta(usuario)}: tiene el rol COMENSAL pero no parece un comensal técnico. No se toca; revisarlo a mano.`,
    );
  }

  if (!APLICAR) {
    for (const usuario of borrar) console.log(`   · ${etiqueta(usuario)}`);
    if (borrar.length > 0) {
      console.log(
        '\nSin cambios. Para borrarlos, confirmá que la API de este entorno ya corre con BL-581 y volvé a correrlo con --aplicar.',
      );
    }
    return;
  }

  let errores = 0;
  for (const usuario of borrar) {
    const res = await fetch(`${ADMIN}/users/${usuario.id}`, {
      method: 'DELETE',
      headers,
    });
    if (res.ok || res.status === 404) {
      console.log(`✅ ${etiqueta(usuario)}: borrado.`);
    } else {
      console.error(
        `❌ ${etiqueta(usuario)}: no se pudo borrar (${res.status}).`,
      );
      errores++;
    }
  }
  if (errores > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
