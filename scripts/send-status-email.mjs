// scripts/send-status-email.mjs
//
// Genera y prepara UN email combinado de estado del proyecto:
//   - Avance general (recalculado desde Linear, misma lógica que
//     update-dashboard-from-linear.mjs).
//   - Resumen breve de calidad (recalculado desde GitHub Issues, misma
//     lógica que update-github-bugs-dashboard.mjs).
//
// Se ejecuta como paso adicional del workflow "Actualizar Dashboard EDT
// desde Linear" (update-dashboard.yml) — en las fechas de cierre de sprint
// y en el disparo manual — NO en el workflow de bugs, que dispara además
// por cada apertura/cierre/label de issue; si el email colgara de ahí se
// mandaría un correo por cada bug individual, no lo que se pidió.
//
// Vuelve a calcular ambos resúmenes de forma independiente (no lee los
// .md ya commiteados) para no depender de si el PR de cada dashboard ya
// fue mergeado: el email siempre refleja el estado más reciente en Linear
// y GitHub, tal como lo calcularon los propios dashboards en su corrida.
//
// Requiere Node 18+ (usa fetch nativo).
//
// Variables de entorno requeridas:
//   LINEAR_API_KEY, LINEAR_TEAM_KEY   -> igual que update-dashboard-from-linear.mjs
//   GITHUB_TOKEN                      -> igual que update-github-bugs-dashboard.mjs
//   GITHUB_REPOSITORY                 -> "owner/repo", GitHub Actions la define sola
//   DASHBOARD_EMAIL_RECIPIENTS        -> emails separados por coma, ej: "a@x.com,b@y.com"
//                                        (BUG-0XX: antes vivía en email-config.json,
//                                        commiteado en claro en un repo público — ahora
//                                        se inyecta como GitHub Secret)
//
// Uso local:
//   LINEAR_API_KEY=xxx LINEAR_TEAM_KEY=BIST GITHUB_TOKEN=yyy \
//   GITHUB_REPOSITORY=owner/repo DASHBOARD_EMAIL_RECIPIENTS=a@x.com,b@y.com \
//   node scripts/send-status-email.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SPRINT_CONFIG_PATH = path.join(__dirname, "sprint-config.json");
const BUGS_CONFIG_PATH = path.join(__dirname, "github-bugs-config.json");
const EMAIL_CONFIG_PATH = path.join(__dirname, "email-config.json");
// Archivo de trabajo del job, NO se commitea al repo (no forma parte de la
// documentación del proyecto, solo lo consume el step de envío de correo).
const EMAIL_BODY_PATH = path.join(ROOT, "email-status.html");

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const LINEAR_TEAM_KEY = process.env.LINEAR_TEAM_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DASHBOARD_EMAIL_RECIPIENTS = process.env.DASHBOARD_EMAIL_RECIPIENTS;

if (!LINEAR_API_KEY || !LINEAR_TEAM_KEY) {
  console.error("Faltan LINEAR_API_KEY y/o LINEAR_TEAM_KEY en el entorno.");
  process.exit(1);
}
if (!GITHUB_TOKEN) {
  console.error("Falta GITHUB_TOKEN en el entorno.");
  process.exit(1);
}
if (!DASHBOARD_EMAIL_RECIPIENTS) {
  console.error("Falta DASHBOARD_EMAIL_RECIPIENTS en el entorno.");
  process.exit(1);
}

function pct(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

// ---------------------------------------------------------------------------
// 1. Avance (Linear) — misma lógica que update-dashboard-from-linear.mjs
// ---------------------------------------------------------------------------

const LINEAR_QUERY = `
  query Issues($teamKey: String!, $after: String) {
    issues(
      first: 100
      after: $after
      filter: { team: { key: { eq: $teamKey } } }
    ) {
      nodes {
        estimate
        state { type }
        cycle { number startsAt endsAt }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

async function fetchAllLinearIssues() {
  const issues = [];
  let after = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: LINEAR_API_KEY },
      body: JSON.stringify({ query: LINEAR_QUERY, variables: { teamKey: LINEAR_TEAM_KEY, after } }),
    });
    if (!res.ok) throw new Error(`Linear API respondió ${res.status}: ${await res.text()}`);

    const json = await res.json();
    if (json.errors) throw new Error(`Linear API error: ${JSON.stringify(json.errors)}`);

    const page = json.data.issues;
    for (const n of page.nodes) {
      if (n.state?.type === "canceled") continue;
      issues.push({
        estimate: n.estimate ?? 0,
        stateType: n.state?.type ?? "unknown",
        cycleNumber: n.cycle?.number ?? null,
        cycleStartsAt: n.cycle?.startsAt ?? null,
        cycleEndsAt: n.cycle?.endsAt ?? null,
      });
    }
    hasNextPage = page.pageInfo.hasNextPage;
    after = page.pageInfo.endCursor;
  }
  return issues;
}

function isCompleted(issue) {
  return issue.stateType === "completed";
}

// Mismo criterio por fecha que el fix aplicado en update-dashboard-from-linear.mjs:
// el ciclo con el número más alto no es necesariamente el activo, porque en
// Linear se pueden precargar historias en ciclos futuros.
function computeSprintActual(issues, hoy = new Date()) {
  const ciclos = new Map();
  for (const i of issues) {
    if (i.cycleNumber != null && i.cycleStartsAt && i.cycleEndsAt) {
      ciclos.set(i.cycleNumber, { start: new Date(i.cycleStartsAt), end: new Date(i.cycleEndsAt) });
    }
  }
  for (const [numero, { start, end }] of ciclos) {
    if (hoy >= start && hoy <= end) return numero;
  }
  const yaEmpezados = [...ciclos.entries()].filter(([, r]) => hoy >= r.start);
  return yaEmpezados.length ? Math.max(...yaEmpezados.map(([n]) => n)) : "—";
}

async function computeProgreso() {
  const config = JSON.parse(await fs.readFile(SPRINT_CONFIG_PATH, "utf-8"));
  const issues = await fetchAllLinearIssues();

  const totalHistoriasUsuario = issues.length;
  const totalStoryPoints = issues.reduce((a, i) => a + i.estimate, 0);
  const spCompletados = issues.filter(isCompleted).reduce((a, i) => a + i.estimate, 0);
  const sprintActual = computeSprintActual(issues);

  const capas = config.capas.map((capa) => {
    const issuesCapa = issues.filter((i) => capa.sprints.includes(i.cycleNumber));
    const huCompletadas = issuesCapa.filter(isCompleted).length;
    const huTotales = issuesCapa.length;
    return { ...capa, huTotales, huCompletadas, pctAvance: pct(huCompletadas, huTotales) };
  });

  const baseline = config.baselineOriginal ?? {};
  const scopeCambio =
    baseline.totalHistoriasUsuario != null && totalHistoriasUsuario !== baseline.totalHistoriasUsuario;

  return {
    sprintActual,
    totalHistoriasUsuario,
    totalStoryPoints,
    spCompletados,
    pctAvanceGlobal: pct(spCompletados, totalStoryPoints),
    scopeCambio,
    baseline,
    capas,
  };
}

// ---------------------------------------------------------------------------
// 2. Calidad (GitHub Issues) — misma lógica que update-github-bugs-dashboard.mjs
// ---------------------------------------------------------------------------

async function fetchAllBugIssues(owner, repo, query) {
  const issues = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const q = encodeURIComponent(`repo:${owner}/${repo} ${query}`);
    const res = await fetch(
      `https://api.github.com/search/issues?q=${q}&per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!res.ok) throw new Error(`GitHub Search API respondió ${res.status}: ${await res.text()}`);

    const json = await res.json();
    for (const item of json.items) {
      if (item.pull_request) continue; // la Search API también devuelve PRs
      issues.push({
        state: item.state, // "open" | "closed"
        createdAt: new Date(item.created_at),
        closedAt: item.closed_at ? new Date(item.closed_at) : null,
      });
    }
    if (json.items.length < perPage || issues.length >= 1000) break;
    page += 1;
  }
  return issues;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=domingo .. 6=sábado
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function computeCalidad() {
  const config = JSON.parse(await fs.readFile(BUGS_CONFIG_PATH, "utf-8"));

  let owner = config.owner;
  let repo = config.repo;
  if ((!owner || !repo) && process.env.GITHUB_REPOSITORY) {
    [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  }
  if (!owner || !repo) {
    throw new Error("No se pudo determinar owner/repo para leer bugs. Completá scripts/github-bugs-config.json.");
  }

  const issues = await fetchAllBugIssues(owner, repo, config.query);
  const abiertos = issues.filter((i) => i.state === "open").length;
  const cerrados = issues.filter((i) => i.state === "closed").length;
  const total = issues.length;

  // Bugs nuevos esta semana vs. la semana pasada: da una idea de tendencia
  // sin repetir el gráfico completo del dashboard (esto es un resumen, no
  // el dashboard entero).
  const hoy = new Date();
  const inicioEstaSemana = startOfWeek(hoy);
  const inicioSemanaPasada = new Date(inicioEstaSemana);
  inicioSemanaPasada.setDate(inicioSemanaPasada.getDate() - 7);

  const nuevosEstaSemana = issues.filter((i) => i.createdAt >= inicioEstaSemana).length;
  const nuevosSemanaPasada = issues.filter(
    (i) => i.createdAt >= inicioSemanaPasada && i.createdAt < inicioEstaSemana
  ).length;

  const tiemposResolucionDias = issues
    .filter((i) => i.state === "closed" && i.closedAt)
    .map((i) => (i.closedAt - i.createdAt) / (1000 * 60 * 60 * 24));
  const promedioDias = tiemposResolucionDias.length
    ? (tiemposResolucionDias.reduce((a, b) => a + b, 0) / tiemposResolucionDias.length).toFixed(1)
    : "—";

  return {
    total,
    abiertos,
    cerrados,
    pctResueltos: pct(cerrados, total),
    promedioDias,
    nuevosEstaSemana,
    nuevosSemanaPasada,
  };
}

// ---------------------------------------------------------------------------
// 3. Armar el email
// ---------------------------------------------------------------------------

function buildRepoFileUrl(subpath) {
  const repo = process.env.GITHUB_REPOSITORY;
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const ref = process.env.GITHUB_REF_NAME || "main";
  if (!repo) return null;
  return `${serverUrl}/${repo}/blob/${ref}/${subpath}`;
}

function fraseTendenciaBugs({ nuevosEstaSemana, nuevosSemanaPasada }) {
  if (nuevosEstaSemana > nuevosSemanaPasada) {
    return `⚠️ Suben los bugs nuevos esta semana (${nuevosEstaSemana} vs. ${nuevosSemanaPasada} la semana pasada).`;
  }
  if (nuevosEstaSemana < nuevosSemanaPasada) {
    return `✅ Bajan los bugs nuevos esta semana (${nuevosEstaSemana} vs. ${nuevosSemanaPasada} la semana pasada).`;
  }
  return `➖ Mismo ritmo de bugs nuevos que la semana pasada (${nuevosEstaSemana}).`;
}

// Email en HTML con estilos inline (los clientes de correo ignoran <style>
// externo, y muchas veces también bloques <style> completos, así que cada
// regla va inline). Layout claro y de alto contraste: no hay forma
// confiable de detectar el modo oscuro de la bandeja de entrada del
// destinatario, y forzar un fondo oscuro puede salir mal si el cliente de
// correo re-invierte colores automáticamente.
function renderEmailBody(progreso, calidad, fechaHoy) {
  const dashboardUrl = buildRepoFileUrl("docs/dashboard-avance-edt.md");
  const bugsUrl = buildRepoFileUrl("docs/dashboard-bugs-github.md");

  const filasCapas = progreso.capas
    .map(
      (c) => `
      <tr>
        <td style="padding:6px 10px; border:1px solid #e2e8f0;">${c.emoji} ${c.nombre}</td>
        <td style="padding:6px 10px; border:1px solid #e2e8f0; text-align:center;">${c.sprints[0]}–${c.sprints[c.sprints.length - 1]}</td>
        <td style="padding:6px 10px; border:1px solid #e2e8f0; text-align:center;">${c.huCompletadas}/${c.huTotales}</td>
        <td style="padding:6px 10px; border:1px solid #e2e8f0; text-align:center;">${c.pctAvance}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0; padding:0; background-color:#f4f5f7; font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7; padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden; border:1px solid #e2e8f0;">

          <tr><td style="background-color:#1a202c; padding:20px 24px;">
            <span style="color:#ffffff; font-size:18px; font-weight:bold;">🚀 BistroLink — Estado del proyecto</span>
          </td></tr>

          <tr><td style="padding:24px;">
            <p style="margin:0 0 20px; color:#2d3748; font-size:14px;">
              Resumen automático generado el <strong>${fechaHoy}</strong>.
            </p>

            <h3 style="margin:0 0 10px; font-size:14px; color:#1a202c;">📊 Avance general</h3>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
              <tr>
                <td style="padding:10px; background-color:#ebf8ff; border-radius:6px; text-align:center; width:33%;">
                  <div style="font-size:22px; font-weight:bold; color:#2b6cb0;">${progreso.sprintActual}</div>
                  <div style="font-size:12px; color:#4a5568;">Sprint actual</div>
                </td>
                <td style="width:8px;"></td>
                <td style="padding:10px; background-color:#faf5ff; border-radius:6px; text-align:center; width:33%;">
                  <div style="font-size:22px; font-weight:bold; color:#805ad5;">${progreso.pctAvanceGlobal}</div>
                  <div style="font-size:12px; color:#4a5568;">Avance global</div>
                </td>
                <td style="width:8px;"></td>
                <td style="padding:10px; background-color:#fff5f5; border-radius:6px; text-align:center; width:33%;">
                  <div style="font-size:22px; font-weight:bold; color:#e05263;">${progreso.spCompletados}/${progreso.totalStoryPoints}</div>
                  <div style="font-size:12px; color:#4a5568;">Story Points</div>
                </td>
              </tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:13px; color:#2d3748; margin-bottom:8px;">
              <tr style="background-color:#f7fafc;">
                <th style="padding:6px 10px; border:1px solid #e2e8f0; text-align:left;">Capa</th>
                <th style="padding:6px 10px; border:1px solid #e2e8f0;">Sprints</th>
                <th style="padding:6px 10px; border:1px solid #e2e8f0;">HU</th>
                <th style="padding:6px 10px; border:1px solid #e2e8f0;">% Avance</th>
              </tr>
              ${filasCapas}
            </table>

            ${
              progreso.scopeCambio
                ? `<p style="margin:0 0 16px; padding:10px 12px; background-color:#fffaf0; border-left:3px solid #f2a541; font-size:12px; color:#744210;">
                    ℹ️ El alcance actual (${progreso.totalHistoriasUsuario} HU / ${progreso.totalStoryPoints} pts) difiere de la línea base de planning (${progreso.baseline.totalHistoriasUsuario} HU / ${progreso.baseline.totalStoryPoints} pts).
                  </p>`
                : ""
            }

            ${
              dashboardUrl
                ? `<p style="margin:0 0 24px; font-size:13px;"><a href="${dashboardUrl}" style="color:#2b6cb0; text-decoration:underline;">Ver dashboard de avance completo →</a></p>`
                : ""
            }

            <h3 style="margin:0 0 10px; font-size:14px; color:#1a202c;">🐛 Calidad (bugs)</h3>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
              <tr>
                <td style="padding:10px; background-color:#f0fff4; border-radius:6px; text-align:center; width:33%;">
                  <div style="font-size:22px; font-weight:bold; color:#38a169;">${calidad.abiertos}</div>
                  <div style="font-size:12px; color:#4a5568;">Bugs abiertos</div>
                </td>
                <td style="width:8px;"></td>
                <td style="padding:10px; background-color:#f7fafc; border-radius:6px; text-align:center; width:33%;">
                  <div style="font-size:22px; font-weight:bold; color:#2d3748;">${calidad.pctResueltos}</div>
                  <div style="font-size:12px; color:#4a5568;">% resueltos (${calidad.cerrados}/${calidad.total})</div>
                </td>
                <td style="width:8px;"></td>
                <td style="padding:10px; background-color:#f7fafc; border-radius:6px; text-align:center; width:33%;">
                  <div style="font-size:22px; font-weight:bold; color:#2d3748;">${calidad.promedioDias}</div>
                  <div style="font-size:12px; color:#4a5568;">días prom. de resolución</div>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 16px; font-size:13px; color:#2d3748;">${fraseTendenciaBugs(calidad)}</p>

            ${
              bugsUrl
                ? `<p style="margin:0; font-size:13px;"><a href="${bugsUrl}" style="color:#2b6cb0; text-decoration:underline;">Ver dashboard de bugs completo →</a></p>`
                : ""
            }
          </td></tr>

          <tr><td style="padding:12px 24px; background-color:#f7fafc; border-top:1px solid #e2e8f0;">
            <span style="font-size:11px; color:#a0aec0;">Generado automáticamente por GitHub Action — no responder a este correo.</span>
          </td></tr>

        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const [progreso, calidad] = await Promise.all([computeProgreso(), computeCalidad()]);
  const fechaHoy = new Date().toISOString().slice(0, 10).split("-").reverse().join("/");

  const emailConfig = JSON.parse(await fs.readFile(EMAIL_CONFIG_PATH, "utf-8"));
  const destinatarios = DASHBOARD_EMAIL_RECIPIENTS.split(",").map((e) => e.trim()).filter(Boolean);
  const html = renderEmailBody(progreso, calidad, fechaHoy);
  await fs.writeFile(EMAIL_BODY_PATH, html, "utf-8");

  const asunto = `${emailConfig.asuntoPrefijo} — Sprint ${progreso.sprintActual} (${progreso.pctAvanceGlobal}, ${calidad.abiertos} bugs abiertos)`;

  if (process.env.GITHUB_OUTPUT) {
    // Formato "key<<EOF\nvalor\nEOF" para el asunto: puede traer paréntesis,
    // %, etc. que romperían un simple "key=valor" de una sola línea.
    const lines = [
      `to=${destinatarios.join(",")}`,
      `from=${emailConfig.remitente}`,
      `subject<<EMAIL_SUBJECT_EOF`,
      asunto,
      `EMAIL_SUBJECT_EOF`,
      `body_path=email-status.html`,
    ].join("\n");
    await fs.appendFile(process.env.GITHUB_OUTPUT, lines + "\n");
  } else {
    console.log(`(local) Email generado en email-status.html — destinatarios: ${destinatarios.join(", ")}`);
  }

  console.log("✅ Resumen de email generado (avance + calidad).");
}

main().catch((err) => {
  console.error("❌ Error generando el email de estado:", err);
  process.exit(1);
});
