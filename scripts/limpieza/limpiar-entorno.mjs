#!/usr/bin/env node
// BL-478 (BL-285, ADR 0011): deja los datos de prueba de local o de staging
// como el seed, antes de una demo o después de una corrida de E2E.
//
//   node scripts/limpieza/limpiar-entorno.mjs [--entorno local|staging]
//        [--aplicar] [--antiguedad-horas N]
//
// - Sin --aplicar es una simulación (dry-run): muestra qué cambiaría.
// - Por cada tenant de testing (A y B) pide un token a su Admin y llama a
//   POST /testing/limpieza con todas las áreas. Después, con el usuario de
//   plataforma (OTP), llama a POST /testing/limpieza/establecimientos.
// - Las rutas solo existen con E2E_CLEANUP_ENABLED=true en el backend.
//
// Node 22, sin dependencias. Ver scripts/limpieza/README.md.

import { createHmac } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Valores por defecto de cada entorno. Las variables de la sesión mandan. */
export const ENTORNOS = {
  local: {
    apiUrl: "http://localhost:3001",
    keycloakUrl: "http://localhost:8080",
    antiguedadHoras: 0,
  },
  staging: {
    apiUrl: "https://bistrolink-api-staging.up.railway.app",
    keycloakUrl: "https://bistrolink-auth-staging.up.railway.app",
    antiguedadHoras: 24,
  },
};

/** Tenants de testing del seed y las variables de su Admin. */
export const TENANTS = [
  {
    nombre: "Tenant A (Restaurante Testing A)",
    usuario: "TEST_ADMIN_USERNAME",
    clave: "TEST_ADMIN_PASSWORD",
  },
  {
    nombre: "Tenant B (Restaurante Testing B)",
    usuario: "TEST_TENANT_B_USERNAME",
    clave: "TEST_TENANT_B_PASSWORD",
  },
];

const VARIABLES_PLATAFORMA = [
  "TEST_PLATAFORMA_USERNAME",
  "TEST_PLATAFORMA_PASSWORD",
  "TEST_PLATAFORMA_OTP_SECRET",
];

const AYUDA = `Uso: node scripts/limpieza/limpiar-entorno.mjs [opciones]

  --entorno local|staging   Dónde limpiar (por defecto: local).
  --aplicar                 Hace los cambios. Sin esto, solo simula (dry-run).
  --antiguedad-horas N      Pedidos abiertos con más de N horas (0 = todos).
                            Por defecto: 0 en local, 24 en staging.
  --ayuda                   Muestra esta ayuda.

Atajos: npm run limpiar:local   ·   npm run limpiar:local -- --aplicar`;

// ── Argumentos ──────────────────────────────────────────────────────────

/** Lee los argumentos. Tira un Error con un mensaje para la persona. */
export function leerArgumentos(argv) {
  const opciones = { entorno: "local", aplicar: false, antiguedadHoras: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const valor = () => {
      const siguiente = argv[i + 1];
      if (siguiente === undefined || siguiente.startsWith("--")) {
        throw new Error(`Falta el valor de ${arg}.`);
      }
      i += 1;
      return siguiente;
    };
    if (arg === "--aplicar") opciones.aplicar = true;
    else if (arg === "--ayuda" || arg === "-h") opciones.ayuda = true;
    else if (arg === "--entorno") opciones.entorno = valor();
    else if (arg.startsWith("--entorno=")) opciones.entorno = arg.slice(10);
    else if (arg === "--antiguedad-horas") {
      opciones.antiguedadHoras = valor();
    } else if (arg.startsWith("--antiguedad-horas=")) {
      opciones.antiguedadHoras = arg.slice(19);
    } else throw new Error(`Opción desconocida: ${arg}`);
  }
  if (!Object.hasOwn(ENTORNOS, opciones.entorno)) {
    throw new Error(
      `--entorno tiene que ser local o staging (nunca producción), no «${opciones.entorno}».`,
    );
  }
  if (opciones.antiguedadHoras === null || opciones.antiguedadHoras === "") {
    opciones.antiguedadHoras = ENTORNOS[opciones.entorno].antiguedadHoras;
  } else {
    const horas = Number(opciones.antiguedadHoras);
    if (!Number.isInteger(horas) || horas < 0 || horas > 720) {
      throw new Error(
        "--antiguedad-horas tiene que ser un entero entre 0 y 720.",
      );
    }
    opciones.antiguedadHoras = horas;
  }
  return opciones;
}

// ── Configuración ───────────────────────────────────────────────────────

/** Lee un .env simple (CLAVE=valor). Sin comillas alrededor del valor. */
export function leerEnv(texto) {
  const variables = {};
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
    );
    if (!m) continue;
    let valor = m[2].trim();
    const comillas = valor.match(/^(['"])(.*)\1$/);
    if (comillas) valor = comillas[2];
    else valor = valor.replace(/\s+#.*$/, "");
    variables[m[1]] = valor;
  }
  return variables;
}

/**
 * Variables que usa el script. En local se completan con
 * apps/backend/.env (mismo Keycloak y mismos usuarios que el backend); las
 * de la sesión mandan. En staging, solo las de la sesión (o los secrets del
 * workflow).
 */
export function configuracion(entorno, sesion = process.env, archivoEnv) {
  const delArchivo =
    entorno === "local" && archivoEnv && existsSync(archivoEnv)
      ? leerEnv(readFileSync(archivoEnv, "utf8"))
      : {};
  const variable = (nombre) => sesion[nombre] || delArchivo[nombre] || "";
  const base = ENTORNOS[entorno];
  const config = {
    apiUrl: (sesion.API_URL || base.apiUrl).replace(/\/$/, ""),
    keycloakUrl: (variable("KEYCLOAK_URL") || base.keycloakUrl).replace(
      /\/$/,
      "",
    ),
    realm: variable("KEYCLOAK_REALM") || "bistrolink",
    clientId: variable("KEYCLOAK_CLIENT_ID") || "bistrolink-backend",
    clientSecret: variable("KEYCLOAK_CLIENT_SECRET"),
    variable,
  };
  // Defensa extra: la ruta no existe en producción, pero tampoco se apunta.
  if (/prod/i.test(config.apiUrl)) {
    throw new Error(
      `API_URL apunta a producción (${config.apiUrl}): no se limpia.`,
    );
  }
  return config;
}

// ── Keycloak ────────────────────────────────────────────────────────────

/** Decodifica una clave Base32 (como la muestra Keycloak). */
export function base32(clave) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const caracter of clave.toUpperCase().replace(/[\s=-]/g, "")) {
    const valor = alfabeto.indexOf(caracter);
    if (valor < 0) throw new Error("TEST_PLATAFORMA_OTP_SECRET no es Base32.");
    bits += valor.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Código TOTP de 6 dígitos (RFC 6238, HMAC-SHA1, 30 s): el mismo algoritmo
 * que e2e/support/plataforma.ts. `desplazamiento` 1 es la ventana siguiente.
 */
export function codigoOtp(clave, desplazamiento = 0, ahoraMs = Date.now()) {
  const paso = Math.floor(ahoraMs / 30_000) + desplazamiento;
  const contador = Buffer.alloc(8);
  contador.writeUInt32BE(Math.floor(paso / 2 ** 32), 0);
  contador.writeUInt32BE(paso % 2 ** 32, 4);
  const hmac = createHmac("sha1", base32(clave)).update(contador).digest();
  const corte = hmac[hmac.length - 1] & 0x0f;
  const numero = (hmac.readUInt32BE(corte) & 0x7fffffff) % 1_000_000;
  return String(numero).padStart(6, "0");
}

/** fetch con un mensaje claro si el servicio no está levantado. */
async function conectar(url, opciones) {
  try {
    return await fetch(url, {
      ...opciones,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const { origin } = new URL(url);
    throw new Error(
      `no se pudo conectar con ${origin} (¿está levantado?): ${err.cause?.code ?? err.message}`,
    );
  }
}

/** Token de acceso por password grant (con OTP si se pasa `totp`). */
async function pedirToken(config, usuario, clave, totp) {
  const cuerpo = new URLSearchParams({
    grant_type: "password",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    username: usuario,
    password: clave,
    scope: "openid",
  });
  // Keycloak lee «otp» (y «totp» en versiones anteriores): van los dos.
  if (totp) {
    cuerpo.set("otp", totp);
    cuerpo.set("totp", totp);
  }
  const res = await conectar(
    `${config.keycloakUrl}/realms/${config.realm}/protocol/openid-connect/token`,
    { method: "POST", body: cuerpo },
  );
  const datos = await res.json().catch(() => ({}));
  if (!res.ok || !datos.access_token) {
    const motivo =
      datos.error_description || datos.error || `HTTP ${res.status}`;
    throw new Error(`Keycloak no dio el token de ${usuario}: ${motivo}`);
  }
  return datos.access_token;
}

/**
 * Token del usuario de plataforma. Keycloak no acepta dos veces el mismo
 * código: si el de esta ventana ya se usó (por ejemplo, un E2E de
 * plataforma recién), prueba con el de la siguiente.
 */
async function tokenPlataforma(config, usuario, clave, otpSecret) {
  try {
    return await pedirToken(config, usuario, clave, codigoOtp(otpSecret, 0));
  } catch {
    return pedirToken(config, usuario, clave, codigoOtp(otpSecret, 1));
  }
}

// ── API ─────────────────────────────────────────────────────────────────

async function llamarLimpieza(config, ruta, token, cuerpo) {
  const res = await conectar(`${config.apiUrl}${ruta}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  if (res.status === 404) {
    throw new Error(
      `${ruta} respondió 404: el backend de ${config.apiUrl} no tiene E2E_CLEANUP_ENABLED=true (o no se reinició).`,
    );
  }
  if (!res.ok) throw new Error(`${ruta} respondió ${res.status}: ${texto}`);
  return JSON.parse(texto);
}

// ── Resumen ─────────────────────────────────────────────────────────────

const ETIQUETAS = {
  pedidos: {
    cancelados: "cancelados (sin pagar)",
    entregados: "entregados (pagados)",
  },
  mesas: {
    reabiertas: "mesas del seed reabiertas",
    liberadas: "liberadas",
    eliminadas: "temporales eliminadas",
    temporalesConPedidos: "temporales con pedidos (quedan libres)",
    zonasEliminadas: "zonas E2E quitadas",
  },
  carta: {
    itemsEliminados: "ítems borrados",
    itemsArchivados: "ítems archivados",
    categoriasEliminadas: "categorías borradas",
    categoriasArchivadas: "categorías archivadas",
    seedRestablecido: "del seed restablecidos",
  },
  usuarios: {
    eliminados: "borrados",
    desactivados: "desactivados",
    conError: "con error",
  },
  establecimientos: {
    eliminados: "borrados",
    suspendidos: "suspendidos (tienen pedidos)",
    cuentasPendientes: "cuentas de Keycloak pendientes",
    conError: "con error",
  },
};

/** «3 cancelados (sin pagar) · 1 entregados (pagados)», o «nada». */
export function describirArea(area, resumen) {
  if (!resumen) return "—";
  if (area === "configuracion") {
    const campos = resumen.camposRestablecidos ?? [];
    return campos.length ? `restablecidos: ${campos.join(", ")}` : "nada";
  }
  const partes = Object.entries(ETIQUETAS[area] ?? {})
    .filter(([clave]) => (resumen[clave] ?? 0) > 0)
    .map(([clave, etiqueta]) => `${resumen[clave]} ${etiqueta}`);
  return partes.length ? partes.join(" · ") : "nada";
}

/** Avisos que no cortan la corrida pero hay que mirar. */
export function avisos(nombre, area, resumen) {
  const lista = [];
  if (resumen?.conError > 0) {
    lista.push(
      `${nombre}: ${resumen.conError} con error en ${area} (ver el log del backend).`,
    );
  }
  if (resumen?.cuentasPendientes > 0) {
    lista.push(
      `${nombre}: ${resumen.cuentasPendientes} cuentas de Keycloak sin borrar (volver a correr).`,
    );
  }
  return lista;
}

/** Resumen en Markdown (consola y $GITHUB_STEP_SUMMARY). */
export function resumenMarkdown({
  entorno,
  aplicar,
  antiguedadHoras,
  filas,
  errores,
  alertas,
}) {
  const lineas = [
    `## Limpieza de ${entorno} ${aplicar ? "(aplicada)" : "(simulación, dry-run)"}`,
    "",
    aplicar
      ? "Se cerraron y restablecieron los datos de prueba (ADR 0011: cerrar, no borrar los pedidos)."
      : "No se cambió nada: muestra lo que haría con `--aplicar`.",
    `Pedidos abiertos con más de **${antiguedadHoras} h** (0 = todos).`,
    "",
    "| Dónde | Área | Resultado |",
    "| --- | --- | --- |",
    ...filas.map(
      ([donde, area, resultado]) => `| ${donde} | ${area} | ${resultado} |`,
    ),
  ];
  if (alertas.length)
    lineas.push("", "**Para revisar:**", ...alertas.map((a) => `- ⚠️ ${a}`));
  if (errores.length)
    lineas.push("", "**Errores:**", ...errores.map((e) => `- ❌ ${e}`));
  return lineas.join("\n");
}

// ── Corrida ─────────────────────────────────────────────────────────────

export async function limpiar(opciones, config) {
  const dryRun = !opciones.aplicar;
  const filas = [];
  const errores = [];
  const alertas = [];

  if (!config.clientSecret) {
    errores.push(
      "Falta KEYCLOAK_CLIENT_SECRET (el del cliente bistrolink-backend de ese entorno).",
    );
    return { filas, errores, alertas };
  }

  for (const tenant of TENANTS) {
    const usuario = config.variable(tenant.usuario);
    const clave = config.variable(tenant.clave);
    if (!usuario || !clave) {
      errores.push(
        `${tenant.nombre}: faltan ${tenant.usuario} o ${tenant.clave}.`,
      );
      continue;
    }
    try {
      const token = await pedirToken(config, usuario, clave);
      const respuesta = await llamarLimpieza(
        config,
        "/testing/limpieza",
        token,
        {
          dryRun,
          antiguedadHoras: opciones.antiguedadHoras,
        },
      );
      for (const area of [
        "pedidos",
        "mesas",
        "carta",
        "configuracion",
        "usuarios",
      ]) {
        filas.push([tenant.nombre, area, describirArea(area, respuesta[area])]);
        alertas.push(...avisos(tenant.nombre, area, respuesta[area]));
      }
    } catch (err) {
      errores.push(`${tenant.nombre}: ${err.message}`);
    }
  }

  const [usuario, clave, otpSecret] = VARIABLES_PLATAFORMA.map(config.variable);
  if (!usuario || !clave || !otpSecret) {
    alertas.push(
      `Plataforma: se saltea, faltan ${VARIABLES_PLATAFORMA.join(", ")}. Los establecimientos «E2E Plataforma …» no se limpiaron.`,
    );
  } else {
    try {
      const token = await tokenPlataforma(config, usuario, clave, otpSecret);
      const respuesta = await llamarLimpieza(
        config,
        "/testing/limpieza/establecimientos",
        token,
        { dryRun },
      );
      filas.push([
        "Plataforma",
        "establecimientos",
        describirArea("establecimientos", respuesta),
      ]);
      alertas.push(...avisos("Plataforma", "establecimientos", respuesta));
    } catch (err) {
      errores.push(`Plataforma: ${err.message}`);
    }
  }
  return { filas, errores, alertas };
}

async function main() {
  let opciones;
  let config;
  try {
    opciones = leerArgumentos(process.argv.slice(2));
    if (opciones.ayuda) {
      console.log(AYUDA);
      return 0;
    }
    config = configuracion(
      opciones.entorno,
      process.env,
      resolve(RAIZ, "apps/backend/.env"),
    );
  } catch (err) {
    console.error(`❌ ${err.message}\n\n${AYUDA}`);
    return 2;
  }

  console.log(
    `Limpieza de ${opciones.entorno} contra ${config.apiUrl} ${opciones.aplicar ? "(aplicando cambios)" : "(dry-run)"}…\n`,
  );
  const resultado = await limpiar(opciones, config);
  const markdown = resumenMarkdown({ ...opciones, ...resultado });
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
  if (process.env.GITHUB_ACTIONS) {
    for (const a of resultado.alertas) console.log(`::warning::${a}`);
    for (const e of resultado.errores) console.log(`::error::${e}`);
  }
  return resultado.errores.length ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main();
}
