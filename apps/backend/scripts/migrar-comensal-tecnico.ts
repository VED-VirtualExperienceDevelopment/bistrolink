import 'dotenv/config';
import {
  planDeMigracion,
  type PasoMigracion,
  type UsuarioKeycloak,
} from '../src/auth-comensal/migracion-comensal-tecnico';
import { emailComensalTecnico } from '../src/auth-comensal/nombre-comensal-tecnico';

/**
 * BL-271 (parte 3): migra los usuarios técnicos del comensal de todos los
 * establecimientos al nombre que no se puede adivinar.
 *
 * Busca en Keycloak los usuarios `comensal-<tenantId>` (el nombre anterior)
 * y, para cada uno:
 * - sin opciones: muestra qué haría, sin cambiar nada;
 * - con --aplicar: crea el usuario nuevo (mismo rol COMENSAL, atributo
 *   tenant_id y contraseña) y prueba que puede iniciar sesión. El anterior
 *   queda: los dos conviven hasta que la API use el nombre nuevo;
 * - con --borrar-anterior --aplicar: borra el usuario anterior, solo si el
 *   nuevo existe y puede iniciar sesión.
 *
 * Orden (ver BL-271): 1) --aplicar; 2) cargar el secreto en Infisical, que
 * lo sincroniza a la API; 3) probar el menú por QR y por enlace web; 4)
 * --borrar-anterior --aplicar. Hasta el paso 4, sacar el secreto de la API
 * vuelve al nombre anterior sin tocar nada más.
 *
 * Uso (desde apps/backend), con las variables en la sesión, nunca en un
 * archivo del repo:
 *
 *   KEYCLOAK_URL, KEYCLOAK_REALM (bistrolink), KEYCLOAK_CLIENT_ID
 *   (bistrolink-backend), KEYCLOAK_CLIENT_SECRET, KEYCLOAK_COMENSAL_PASSWORD
 *   y KEYCLOAK_COMENSAL_USERNAME_SECRET
 *
 *   npx ts-node scripts/migrar-comensal-tecnico.ts
 *   npx ts-node scripts/migrar-comensal-tecnico.ts --aplicar
 *   npx ts-node scripts/migrar-comensal-tecnico.ts --borrar-anterior --aplicar
 *
 * Se puede correr las veces que haga falta: lo que ya está hecho no se repite.
 */

const APLICAR = process.argv.includes('--aplicar');
const BORRAR_ANTERIOR = process.argv.includes('--borrar-anterior');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';
const COMENSAL_PASSWORD = process.env.KEYCLOAK_COMENSAL_PASSWORD ?? '';
const SECRETO = process.env.KEYCLOAK_COMENSAL_USERNAME_SECRET ?? '';

const faltantes = [
  ['KEYCLOAK_CLIENT_SECRET', CLIENT_SECRET],
  ['KEYCLOAK_COMENSAL_PASSWORD', COMENSAL_PASSWORD],
  ['KEYCLOAK_COMENSAL_USERNAME_SECRET', SECRETO],
].filter(([, valor]) => !valor);
if (faltantes.length > 0) {
  console.error(`Faltan variables: ${faltantes.map(([n]) => n).join(', ')}`);
  process.exit(1);
}

const ADMIN = `${KEYCLOAK_URL}/admin/realms/${REALM}`;

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

/** Todos los usuarios cuyo nombre contiene «comensal-», de a 100. */
async function usuariosComensal(
  headers: Record<string, string>,
): Promise<UsuarioKeycloak[]> {
  const usuarios: UsuarioKeycloak[] = [];
  for (let first = 0; ; first += 100) {
    const res = await fetch(
      `${ADMIN}/users?search=comensal-&briefRepresentation=false&first=${first}&max=100`,
      { headers },
    );
    if (!res.ok) throw new Error(`No se pudo listar usuarios: ${res.status}`);
    const pagina = (await res.json()) as UsuarioKeycloak[];
    usuarios.push(...pagina);
    if (pagina.length < 100) return usuarios;
  }
}

/** El usuario puede iniciar sesión como lo hace la API (password grant). */
async function puedeIniciarSesion(username: string): Promise<boolean> {
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        username,
        password: COMENSAL_PASSWORD,
      }),
    },
  );
  return res.ok;
}

async function crearNuevo(
  paso: PasoMigracion,
  headers: Record<string, string>,
  rol: { id: string; name: string },
): Promise<string> {
  const crear = await fetch(`${ADMIN}/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      username: paso.nuevo,
      email: emailComensalTecnico(paso.tenantId, SECRETO),
      firstName: 'Comensal',
      lastName: 'Técnico',
      enabled: true,
      emailVerified: true,
      requiredActions: [],
      attributes: { tenant_id: [paso.tenantId] },
      credentials: [
        { type: 'password', value: COMENSAL_PASSWORD, temporary: false },
      ],
    }),
  });
  if (crear.status !== 201) {
    throw new Error(
      `No se pudo crear el usuario del tenant ${paso.tenantId}: ${crear.status} ${await crear.text()}`,
    );
  }
  const id = crear.headers.get('Location')!.split('/').pop()!;
  const asignar = await fetch(`${ADMIN}/users/${id}/role-mappings/realm`, {
    method: 'POST',
    headers,
    body: JSON.stringify([rol]),
  });
  if (!asignar.ok) {
    throw new Error(
      `Usuario del tenant ${paso.tenantId} creado sin el rol COMENSAL: ${asignar.status}`,
    );
  }
  return id;
}

async function main() {
  const token = await tokenDeServicio();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const pasos = planDeMigracion(await usuariosComensal(headers), SECRETO);
  console.log(
    `Keycloak ${KEYCLOAK_URL}, realm ${REALM}: ${pasos.length} usuarios con el nombre anterior.`,
  );
  if (pasos.length === 0) return;

  const rolRes = await fetch(`${ADMIN}/roles/COMENSAL`, { headers });
  if (!rolRes.ok)
    throw new Error(`No existe el rol COMENSAL: ${rolRes.status}`);
  const { id: rolId, name: rolNombre } = (await rolRes.json()) as {
    id: string;
    name: string;
  };

  let errores = 0;
  for (const paso of pasos) {
    // El nombre nuevo no se muestra: es justamente lo que no se tiene que
    // poder adivinar. Se identifica por el tenant.
    const etiqueta = `tenant ${paso.tenantId}`;
    if (paso.inconsistente) {
      console.warn(
        `⚠️  ${etiqueta}: el atributo tenant_id no coincide con el nombre. No se toca; revisarlo a mano.`,
      );
      errores++;
      continue;
    }

    if (!BORRAR_ANTERIOR) {
      if (paso.nuevoId) {
        const ok = await puedeIniciarSesion(paso.nuevo);
        console.log(
          `${ok ? '✅' : '❌'} ${etiqueta}: el usuario nuevo ya existe${ok ? ' e inicia sesión' : ' pero NO inicia sesión'}.`,
        );
        if (!ok) errores++;
        continue;
      }
      if (!APLICAR) {
        console.log(`➕ ${etiqueta}: se crearía el usuario nuevo.`);
        continue;
      }
      await crearNuevo(paso, headers, { id: rolId, name: rolNombre });
      const ok = await puedeIniciarSesion(paso.nuevo);
      console.log(
        `${ok ? '✅' : '❌'} ${etiqueta}: usuario nuevo creado${ok ? ' e inicia sesión' : ' pero NO inicia sesión'}.`,
      );
      if (!ok) errores++;
      continue;
    }

    // --borrar-anterior: solo si el nuevo existe y puede iniciar sesión.
    if (!paso.nuevoId || !(await puedeIniciarSesion(paso.nuevo))) {
      console.warn(
        `⚠️  ${etiqueta}: el usuario nuevo no existe o no inicia sesión. No se borra el anterior.`,
      );
      errores++;
      continue;
    }
    if (!APLICAR) {
      console.log(`🗑️  ${etiqueta}: se borraría ${paso.anterior.username}.`);
      continue;
    }
    const borrar = await fetch(`${ADMIN}/users/${paso.anterior.id}`, {
      method: 'DELETE',
      headers,
    });
    if (borrar.ok) {
      console.log(`🗑️  ${etiqueta}: borrado ${paso.anterior.username}.`);
    } else {
      console.error(`❌ ${etiqueta}: no se pudo borrar (${borrar.status}).`);
      errores++;
    }
  }

  if (!APLICAR) {
    console.log('\nNo se cambió nada. Para aplicarlo, agregá --aplicar.');
  }
  if (errores > 0) {
    console.error(`\n${errores} con problemas: revisá los avisos de arriba.`);
    process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
