#!/usr/bin/env node
// BL-599: avisa por correo cuando un E2E empieza a fallar en develop.
//
// En develop los E2E son informativos (BL-250): si fallan, el pipeline sigue
// en verde. Este script compara los resultados de la corrida con los de la
// corrida anterior de develop y, si hay fallos nuevos, arma un correo para
// el equipo que nombra a los autores de los PR mergeados entre las dos
// corridas y les pide verificar los tests. Lo manda enviar-email.mjs con la
// cuenta del environment «notificaciones» (BL-326), en el mismo job.
//
// Fallo nuevo: un test (por navegador) que falla ahora, después de los
// reintentos, y en la corrida anterior pasaba, estaba salteado o no
// existía. Los que ya fallaban antes no se avisan.
//
// El repositorio es público: el correo no lleva mensajes de error (pueden
// traer datos de la sesión de prueba), y los destinatarios salen del mismo
// secret que el correo de estado (DASHBOARD_EMAIL_RECIPIENTS) y se
// enmascaran en el log.
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
//   MAIL_USERNAME         cuenta que envía (para el remitente)
//   ALLURE_REPORT_URL     enlace al reporte Allure publicado (opcional)
//   GITHUB_OUTPUT, GITHUB_STEP_SUMMARY, RUNNER_TEMP (los pone Actions)
// Salidas (GITHUB_OUTPUT): enviar, to, from, subject, body_path.

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

/** Lee todos los junit.xml de las subcarpetas de una carpeta. */
export async function leerCarpeta(carpeta) {
  const estados = new Map();
  let archivos = 0;
  for (const entrada of await fs.readdir(carpeta, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const ruta = path.join(carpeta, entrada.name, "junit.xml");
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

/** Cuerpo HTML del correo. Sin mensajes de error: solo nombres y enlaces. */
export function cuerpoCorreo({
  fallos,
  prs,
  autores,
  corrida,
  urlCorrida,
  urlAllure,
}) {
  const filas = fallos
    .map(
      (f) =>
        `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${escapar(f.test)}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #eee">${escapar(f.navegador)}</td></tr>`,
    )
    .join("\n");
  const cambios = prs.length
    ? `<ul>${prs
        .map(
          (p) =>
            `<li>#${escapar(p.numero)} ${escapar(p.titulo)} (${escapar(p.autor ?? "—")})</li>`,
        )
        .join("")}</ul>`
    : "<p>No se encontró el PR de los cambios: revisá los commits de la corrida.</p>";
  const enlaces = [
    `<li><a href="${escapar(urlCorrida)}">Corrida #${escapar(corrida)} en GitHub Actions</a></li>`,
    urlAllure
      ? `<li><a href="${escapar(urlAllure)}">Reporte Allure de los E2E</a></li>`
      : "",
    "<li>El detalle completo de cada navegador está en el artifact cifrado <code>playwright-report-&lt;navegador&gt;</code> de la corrida (cómo abrirlo: <code>e2e/README.md</code>).</li>",
  ].join("");

  return `<!DOCTYPE html>
<html lang="es"><body style="font-family:Arial,sans-serif;color:#1c1b20;max-width:720px">
<h2 style="color:#4f378a">E2E que empezaron a fallar en develop</h2>
<p>Hola${autores.length ? ` ${escapar(mencionar(autores))}` : ""}: en la corrida #${escapar(corrida)} de develop hay ${fallos.length} E2E que en la corrida anterior pasaban y ahora fallan. Pueden venir de estos cambios:</p>
${cambios}
<p><strong>${autores.length ? "Por favor, verificá" : "Por favor, verifiquen"} los tests que fallan</strong>: si es un defecto del producto, registralo como GitHub Issue; si el test quedó desactualizado por el cambio, ajustalo. En develop los E2E no frenan el pipeline, pero tienen que estar en verde antes del próximo release.</p>
<table style="border-collapse:collapse;width:100%">
<tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #4f378a">Test</th><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #4f378a">Navegador</th></tr>
${filas}
</table>
<ul>${enlaces}</ul>
<p style="color:#7a7582;font-size:12px">Aviso automático del CI de BistroLink (BL-599). Los tests que ya fallaban en la corrida anterior no se incluyen.</p>
</body></html>
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

export async function main(argv = process.argv.slice(2), env = process.env) {
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
  });
  const to = destinatarios(env.EQUIPO_CORREOS);
  if (to.length === 0)
    throw new Error("No hay destinatarios: revisar EQUIPO_CORREOS");

  // Los correos no pueden quedar en el log: el repositorio es público.
  for (const correo of to) console.log(`::add-mask::${correo}`);

  const corrida = env.GITHUB_RUN_NUMBER ?? env.GITHUB_RUN_ID;
  const urlCorrida = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const carpetaTmp = env.RUNNER_TEMP || ".";
  const rutaCuerpo = path.join(carpetaTmp, "aviso-e2e.html");
  await fs.writeFile(
    rutaCuerpo,
    cuerpoCorreo({
      fallos,
      prs,
      corrida,
      urlCorrida,
      urlAllure: env.ALLURE_REPORT_URL,
    }),
    "utf-8",
  );

  await salida(env, {
    enviar: "true",
    to: to.join(","),
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
      `Autores: ${mencionar(autores) || "—"}. Se avisa al equipo (${to.length} destinatario(s)).\n\n${lista}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
