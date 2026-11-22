#!/usr/bin/env node
// BL-599: avisa por correo cuando un E2E empieza a fallar en develop.
//
// En develop los E2E son informativos (BL-250): si fallan, el pipeline sigue
// en verde. Este script compara los resultados de la corrida con los de la
// corrida anterior de develop y, si hay fallos nuevos, arma un correo
// dirigido a los autores de los PR mergeados entre las dos corridas, con el
// resto del equipo en copia, que les pide verificar los tests. Si no se
// encuentra el correo de ningún autor, va a todo el equipo. Lo manda
// enviar-email.mjs con la cuenta del environment «notificaciones» (BL-326),
// en el mismo job.
//
// Fallo nuevo: un test (por navegador) que falla ahora, después de los
// reintentos, y en la corrida anterior pasaba, estaba salteado o no
// existía. Los que ya fallaban antes no se avisan.
//
// El repositorio es público: el correo no lleva mensajes de error (pueden
// traer datos de la sesión de prueba), y los correos salen de secrets
// (DASHBOARD_EMAIL_RECIPIENTS, el mismo del correo de estado, y
// EQUIPO_GITHUB_CORREOS) y se enmascaran en el log.
//
// Uso:
//   node scripts/dashboards/aviso-e2e.mjs --actual <carpeta> [--anterior <carpeta>]
// Cada carpeta tiene una subcarpeta por navegador con su junit.xml (como las
// deja actions/download-artifact). Sin --anterior no se avisa nada.
//
// Variables:
//   GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_RUN_ID, GITHUB_RUN_NUMBER,
//   GITHUB_SERVER_URL, GITHUB_API_URL, GITHUB_TOKEN (permiso pull-requests: read)
//   SHA_ANTERIOR          commit de la corrida anterior (rango de cambios)
//   EQUIPO_CORREOS        correos del equipo, separados por coma
//                         (secret DASHBOARD_EMAIL_RECIPIENTS)
//   EQUIPO_GITHUB         usuario de GitHub y correo de cada integrante,
//                         «usuario=correo» separados por coma (secret
//                         EQUIPO_GITHUB_CORREOS; opcional: sin él, el correo
//                         va a todo el equipo)
//   MAIL_USERNAME         cuenta que envía (para el remitente)
//   ALLURE_REPORT_URL     enlace al reporte Allure publicado (opcional)
//   GITHUB_OUTPUT, GITHUB_STEP_SUMMARY, RUNNER_TEMP (los pone Actions)
// Salidas (GITHUB_OUTPUT): enviar, to, cc, from, subject, body_path.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── junit.xml de Playwright ───────────────────────────────────────────────

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodificar(texto) {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (todo, e) => {
    if (e[0] === "#") {
      const codigo =
        e[1].toLowerCase() === "x"
          ? parseInt(e.slice(2), 16)
          : Number(e.slice(1));
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : todo;
    }
    return ENTIDADES[e.toLowerCase()] ?? todo;
  });
}

function atributos(texto) {
  const resultado = {};
  for (const m of texto.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    resultado[m[1]] = decodificar(m[2]);
  }
  return resultado;
}

/**
 * Estado de cada test de un junit.xml de Playwright: Map de
 * «navegador › nombre del test» → "falla" | "salteado" | "pasa".
 * El navegador es el atributo hostname de la <testsuite> (el proyecto).
 */
export function leerJunit(xml, estados = new Map()) {
  for (const suite of xml.matchAll(
    /<testsuite\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testsuite>)/g,
  )) {
    const proyecto = atributos(suite[1]).hostname || "?";
    for (const caso of (suite[2] ?? "").matchAll(
      /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g,
    )) {
      const nombre = atributos(caso[1]).name ?? "";
      const cuerpo = caso[2] ?? "";
      const estado = /<(failure|error)\b/.test(cuerpo)
        ? "falla"
        : /<skipped\b/.test(cuerpo)
          ? "salteado"
          : "pasa";
      estados.set(`${proyecto} › ${nombre}`, estado);
    }
  }
  return estados;
}

/**
 * Lee los junit.xml de una carpeta: el de cada subcarpeta (un artifact por
 * navegador) y, si está, el de la carpeta misma (gh run download no crea la
 * subcarpeta cuando baja un solo artifact).
 */
export async function leerCarpeta(carpeta) {
  const estados = new Map();
  let archivos = 0;
  const rutas = [path.join(carpeta, "junit.xml")];
  for (const entrada of await fs.readdir(carpeta, { withFileTypes: true })) {
    if (entrada.isDirectory())
      rutas.push(path.join(carpeta, entrada.name, "junit.xml"));
  }
  for (const ruta of rutas) {
    try {
      leerJunit(await fs.readFile(ruta, "utf-8"), estados);
      archivos += 1;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return { estados, archivos };
}

/** Tests que fallan ahora y antes no fallaban, ordenados. */
export function fallosNuevos(actual, anterior) {
  const nuevos = [];
  for (const [clave, estado] of actual) {
    if (estado === "falla" && anterior.get(clave) !== "falla") {
      const [navegador, ...resto] = clave.split(" › ");
      nuevos.push({ navegador, test: resto.join(" › ") });
    }
  }
  return nuevos.sort(
    (a, b) =>
      a.test.localeCompare(b.test, "es") ||
      a.navegador.localeCompare(b.navegador),
  );
}

// ── Autores de los cambios (API de GitHub) ────────────────────────────────

/**
 * PR y autores de los commits entre la corrida anterior y esta. Para cada
 * commit busca el PR que lo trajo; sin PR, usa el autor del commit.
 */
export async function cambiosDelRango({
  api,
  repo,
  base,
  head,
  token,
  fetch = globalThis.fetch,
}) {
  const cabeceras = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const pedir = async (ruta) => {
    const respuesta = await fetch(`${api}/repos/${repo}${ruta}`, {
      headers: cabeceras,
    });
    if (!respuesta.ok)
      throw new Error(`GitHub respondió ${respuesta.status} en ${ruta}`);
    return respuesta.json();
  };

  const commits = base
    ? ((await pedir(`/compare/${base}...${head}`)).commits ?? [])
    : [await pedir(`/commits/${head}`)];

  const prs = new Map();
  const autores = new Set();
  for (const commit of commits) {
    const asociados = await pedir(`/commits/${commit.sha}/pulls`);
    const pr = asociados.find((p) => p.merged_at) ?? asociados[0];
    const login = pr?.user?.login ?? commit.author?.login;
    if (login && !login.endsWith("[bot]")) autores.add(login);
    if (pr && !prs.has(pr.number)) {
      prs.set(pr.number, {
        numero: pr.number,
        titulo: pr.title,
        autor: pr.user?.login,
      });
    }
  }
  return { autores: [...autores].sort(), prs: [...prs.values()] };
}

// ── Destinatarios y correo ────────────────────────────────────────────────

/** Correos del equipo, sin vacíos ni repetidos. */
export function destinatarios(equipo) {
  const vistos = new Set();
  return (equipo ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(
      (c) => c && !vistos.has(c.toLowerCase()) && vistos.add(c.toLowerCase()),
    );
}

/**
 * Correo de cada usuario de GitHub, desde «usuario=correo» separados por
 * coma. El usuario se compara sin mayúsculas, como en GitHub.
 */
export function correosPorUsuario(texto) {
  const mapa = new Map();
  for (const par of (texto ?? "").split(",")) {
    const [usuario, correo] = par.split("=").map((t) => t?.trim());
    if (usuario && correo) mapa.set(usuario.toLowerCase(), correo);
  }
  return mapa;
}

/**
 * Para: los autores con correo conocido. Copia: el resto del equipo. Si no
 * se conoce el correo de ningún autor, va a todo el equipo sin copia.
 */
export function repartirDestinatarios({ autores, equipo, correos }) {
  const para = destinatarios(
    autores
      .map((a) => correos.get(a.toLowerCase()))
      .filter(Boolean)
      .join(","),
  );
  if (para.length === 0) return { para: equipo, copia: [], personal: false };
  const enPara = new Set(para.map((c) => c.toLowerCase()));
  return {
    para,
    copia: equipo.filter((c) => !enPara.has(c.toLowerCase())),
    personal: true,
  };
}

/** «@ana», «@ana y @beto», «@ana, @beto y @caro». */
export function mencionar(autores) {
  const conArroba = autores.map((a) => `@${a}`);
  if (conArroba.length <= 1) return conArroba.join("");
  return `${conArroba.slice(0, -1).join(", ")} y ${conArroba.at(-1)}`;
}

const escapar = (t) =>
  `${t ?? ""}`.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

/**
 * Enlace para reportar el bug con la plantilla de bug (BL-601), con el
 * entorno, el PR y las etiquetas «bug» y «regresion» ya completos: un E2E
 * que pasaba y ahora falla es una regresión. GitHub completa los campos del
 * formulario por su id (bug.yml).
 */
export function urlNuevoIssue({ servidor, repo, prs = [] }) {
  const parametros = new URLSearchParams({
    template: "bug.yml",
    labels: "bug,regresion",
    entorno: "Staging",
  });
  if (prs.length)
    parametros.set("introducido", prs.map((p) => `#${p.numero}`).join(", "));
  return `${servidor || "https://github.com"}/${repo}/issues/new?${parametros}`;
}

// Paleta del correo de estado (send-status-email.mjs): misma marca.
const MARCA = {
  fondo: "#fdf8ff",
  borde: "#cbc4d2",
  encabezado: "#381e72",
  primario: "#4f378a",
  suave: "#e9ddff",
  tabla: "#e0d4fd",
  pie: "#f7f2fa",
  texto: "#1c1b20",
  secundario: "#494551",
  tenue: "#7a7582",
  aviso: "#ffdf93",
  avisoTexto: "#594400",
};

const celda = `padding:6px 10px; border:1px solid ${MARCA.borde};`;
const enlace = (url, texto) =>
  `<a href="${escapar(url)}" style="color:${MARCA.primario}; text-decoration:underline;">${texto}</a>`;

/**
 * Cuerpo HTML del correo, con la marca del correo de estado. Sin mensajes de
 * error: solo nombres y enlaces. «personal»: va dirigido a los autores, con
 * el equipo en copia; si no, al equipo.
 */
export function cuerpoCorreo({
  fallos,
  prs = [],
  autores = [],
  personal = false,
  corrida,
  urlCorrida,
  urlAllure,
  urlIssue,
  urlSeguridad,
}) {
  const varios = autores.length > 1;
  const saludo = autores.length
    ? `Hola ${escapar(mencionar(autores))}`
    : "Hola, equipo";
  const intro = personal
    ? `en la corrida #${escapar(corrida)} de develop hay <strong>${fallos.length} E2E</strong> que en la corrida anterior pasaban y ahora fallan. Entre las dos corridas ${varios ? "entraron sus PR" : prs.length > 1 ? "entraron tus PR" : "entró tu PR"}:`
    : `en la corrida #${escapar(corrida)} de develop hay <strong>${fallos.length} E2E</strong> que en la corrida anterior pasaban y ahora fallan. Pueden venir de estos cambios:`;
  const pedido =
    autores.length === 1
      ? "Por favor, verificá los tests que fallan"
      : "Por favor, verifiquen los tests que fallan";

  const filas = fallos
    .map(
      (f) =>
        `<tr><td style="${celda}">${escapar(f.test)}</td>` +
        `<td style="${celda} text-align:center;">${escapar(f.navegador)}</td></tr>`,
    )
    .join("\n");
  const cambios = prs.length
    ? `<ul style="margin:0 0 16px; padding-left:20px; font-size:13px; color:${MARCA.texto};">${prs
        .map(
          (p) =>
            `<li>#${escapar(p.numero)} ${escapar(p.titulo)} (${escapar(p.autor ?? "—")})</li>`,
        )
        .join("")}</ul>`
    : `<p style="margin:0 0 16px; font-size:13px; color:${MARCA.texto};">No se encontró el PR de los cambios: revisá los commits de la corrida.</p>`;
  const enlaces = [
    `<li>${enlace(urlCorrida, `Corrida #${escapar(corrida)} en GitHub Actions →`)}</li>`,
    urlAllure
      ? `<li>${enlace(urlAllure, "Reporte Allure de los E2E →")}</li>`
      : "",
    `<li style="color:${MARCA.secundario};">El detalle completo de cada navegador está en el artifact cifrado <code>playwright-report-&lt;navegador&gt;</code> de la corrida (cómo abrirlo: <code>e2e/README.md</code>).</li>`,
  ].join("");
  const reportar = urlIssue
    ? `
            <h3 style="margin:20px 0 10px; font-size:14px; color:${MARCA.encabezado};">🐛 Dónde reportarlo</h3>
            <p style="margin:0 0 8px; font-size:13px; color:${MARCA.texto};">${enlace(urlIssue, "Reportar el bug en GitHub Issues →")}</p>
            <p style="margin:0; font-size:12px; color:${MARCA.secundario};">Abre la plantilla de bug con el entorno (Staging)${prs.length ? ", el PR" : ""} y las etiquetas <code>bug</code> y <code>regresion</code>. Completá qué pasa y cómo reproducirlo, sin pegar mensajes de error ni datos de la sesión: el repositorio es público.${urlSeguridad ? ` Si es una vulnerabilidad, no abras un issue: seguí ${enlace(urlSeguridad, "SECURITY.md")}.` : ""}</p>`
    : "";
  const copia = personal
    ? " El resto del equipo recibe este aviso en copia."
    : "";

  return `<!doctype html>
<html lang="es">
  <body style="margin:0; padding:0; background-color:${MARCA.fondo}; font-family: 'Plus Jakarta Sans', -apple-system, Segoe UI, Roboto, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${MARCA.fondo}; padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden; border:1px solid ${MARCA.borde};">

          <tr><td style="background-color:${MARCA.encabezado}; padding:20px 24px;">
            <span style="color:#ffffff; font-size:18px; font-weight:bold;">⚠️ BistroLink — E2E que empezaron a fallar</span>
          </td></tr>

          <tr><td style="padding:24px;">
            <p style="margin:0 0 16px; color:${MARCA.texto}; font-size:14px;">${saludo}: ${intro}</p>
            ${cambios}

            <p style="margin:0 0 20px; padding:10px 12px; background-color:${MARCA.aviso}; border-left:3px solid ${MARCA.avisoTexto}; font-size:13px; color:${MARCA.avisoTexto};">
              <strong>${pedido}</strong>: si es un defecto del producto, registralo como GitHub Issue (abajo); si el test quedó desactualizado por el cambio, ajustalo. En develop los E2E no frenan el pipeline, pero tienen que estar en verde antes del próximo release.
            </p>

            <h3 style="margin:0 0 10px; font-size:14px; color:${MARCA.encabezado};">🧪 Tests que empezaron a fallar</h3>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:13px; color:${MARCA.texto}; margin-bottom:20px;">
              <tr style="background-color:${MARCA.tabla}; color:${MARCA.encabezado};">
                <th style="${celda} text-align:left;">Test</th>
                <th style="${celda}">Navegador</th>
              </tr>
              ${filas}
            </table>

            <h3 style="margin:0 0 10px; font-size:14px; color:${MARCA.encabezado};">🔎 Dónde ver el detalle</h3>
            <ul style="margin:0; padding-left:20px; font-size:13px; line-height:1.6;">${enlaces}</ul>
            ${reportar}
          </td></tr>

          <tr><td style="padding:12px 24px; background-color:${MARCA.pie}; border-top:1px solid ${MARCA.borde};">
            <span style="font-size:11px; color:${MARCA.tenue};">Aviso automático del CI de BistroLink (BL-599) — no responder a este correo. Los tests que ya fallaban en la corrida anterior no se incluyen.${copia}</span>
          </td></tr>

        </table>
      </td></tr>
    </table>
  </body>
</html>
`;
}

// ── Main ──────────────────────────────────────────────────────────────────

function opciones(argv) {
  const resultado = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === "--actual") resultado.actual = argv[i + 1];
    else if (argv[i] === "--anterior") resultado.anterior = argv[i + 1];
    else throw new Error(`Opción desconocida: ${argv[i]}`);
  }
  if (!resultado.actual) {
    throw new Error(
      "Uso: aviso-e2e.mjs --actual <carpeta> [--anterior <carpeta>]",
    );
  }
  return resultado;
}

async function salida(env, valores) {
  if (!env.GITHUB_OUTPUT) return;
  const lineas = Object.entries(valores).map(
    ([clave, valor]) => `${clave}=${valor}`,
  );
  await fs.appendFile(env.GITHUB_OUTPUT, `${lineas.join("\n")}\n`, "utf-8");
}

async function resumen(env, texto) {
  if (env.GITHUB_STEP_SUMMARY)
    await fs.appendFile(env.GITHUB_STEP_SUMMARY, `${texto}\n`, "utf-8");
  console.log(texto.replace(/^#+ /gm, ""));
}

export async function main(
  argv = process.argv.slice(2),
  env = process.env,
  fetch = globalThis.fetch,
) {
  const { actual, anterior } = opciones(argv);
  const titulo = "### 📧 Aviso de E2E nuevos con fallos";

  const hoy = await leerCarpeta(actual);
  if (!anterior) {
    await salida(env, { enviar: "false" });
    await resumen(
      env,
      `${titulo}\n\nNo hay una corrida anterior de develop para comparar: no se avisa.`,
    );
    return;
  }
  const antes = await leerCarpeta(anterior);
  if (hoy.archivos === 0 || antes.archivos === 0) {
    await salida(env, { enviar: "false" });
    await resumen(
      env,
      `${titulo}\n\nFaltan resultados de esta corrida o de la anterior: no se avisa.`,
    );
    return;
  }

  const fallos = fallosNuevos(hoy.estados, antes.estados);
  if (fallos.length === 0) {
    await salida(env, { enviar: "false" });
    await resumen(
      env,
      `${titulo}\n\nNingún E2E empezó a fallar en esta corrida.`,
    );
    return;
  }

  const { autores, prs } = await cambiosDelRango({
    api: env.GITHUB_API_URL || "https://api.github.com",
    repo: env.GITHUB_REPOSITORY,
    base: env.SHA_ANTERIOR?.trim() || null,
    head: env.GITHUB_SHA,
    token: env.GITHUB_TOKEN,
    fetch,
  });
  const equipo = destinatarios(env.EQUIPO_CORREOS);
  if (equipo.length === 0)
    throw new Error("No hay destinatarios: revisar EQUIPO_CORREOS");
  const correos = correosPorUsuario(env.EQUIPO_GITHUB);
  const { para, copia, personal } = repartirDestinatarios({
    autores,
    equipo,
    correos,
  });

  // Los correos no pueden quedar en el log: el repositorio es público.
  for (const correo of new Set([...equipo, ...correos.values()]))
    console.log(`::add-mask::${correo}`);

  const corrida = env.GITHUB_RUN_NUMBER ?? env.GITHUB_RUN_ID;
  const urlCorrida = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const carpetaTmp = env.RUNNER_TEMP || ".";
  const rutaCuerpo = path.join(carpetaTmp, "aviso-e2e.html");
  await fs.writeFile(
    rutaCuerpo,
    cuerpoCorreo({
      fallos,
      prs,
      autores,
      personal,
      corrida,
      urlCorrida,
      urlAllure: env.ALLURE_REPORT_URL,
      urlIssue: urlNuevoIssue({
        servidor: env.GITHUB_SERVER_URL,
        repo: env.GITHUB_REPOSITORY,
        prs,
      }),
      urlSeguridad: `${env.GITHUB_SERVER_URL || "https://github.com"}/${env.GITHUB_REPOSITORY}/blob/develop/SECURITY.md`,
    }),
    "utf-8",
  );

  await salida(env, {
    enviar: "true",
    to: para.join(","),
    cc: copia.join(","),
    from: `BistroLink CI <${env.MAIL_USERNAME ?? ""}>`,
    subject:
      `⚠️ BistroLink — ${fallos.length} E2E empezaron a fallar en develop (corrida #${corrida})` +
      (autores.length ? ` · ${mencionar(autores)}` : ""),
    body_path: rutaCuerpo,
  });

  const lista = fallos.map((f) => `- ${f.test} (${f.navegador})`).join("\n");
  const prsTexto = prs.map((p) => `#${p.numero}`).join(", ") || "—";
  await resumen(
    env,
    `${titulo}\n\n${fallos.length} E2E empezaron a fallar. Cambios: ${prsTexto}. ` +
      `Autores: ${mencionar(autores) || "—"}. ${personal ? `Se avisa a los autores (${para.length}) con el equipo en copia (${copia.length}).` : `Se avisa al equipo (${para.length} destinatario(s)).`}\n\n${lista}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
