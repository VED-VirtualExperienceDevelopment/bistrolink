// scripts/update-github-bugs-dashboard.mjs
//
// Consulta issues marcados como bug en GitHub (via Search API), calcula:
//   - conteo de abiertos / cerrados
//   - tendencia semanal de abiertos vs. cerrados
//   - tiempo promedio y mediana de resolución
// y reescribe las secciones marcadas con <!-- AUTO:...:start/end --> en
// dashboard-bugs-github.md.
//
// Requiere Node 18+ (usa fetch nativo).
//
// Variables de entorno:
//   GITHUB_TOKEN      -> en GitHub Actions ya viene solo (secrets.GITHUB_TOKEN),
//                        no hace falta crear nada nuevo.
//   GITHUB_REPOSITORY -> "owner/repo", GitHub Actions la define sola.
//                        Si corrés local, seteala vos o completá owner/repo
//                        en scripts/github-bugs-config.json.
//
// Uso local:
//   GITHUB_TOKEN=xxx GITHUB_REPOSITORY=owner/repo node scripts/update-github-bugs-dashboard.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DASHBOARD_PATH = path.join(ROOT, "docs", "dashboard-bugs-github.md");
const CONFIG_PATH = path.join(__dirname, "github-bugs-config.json");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error("Falta GITHUB_TOKEN en el entorno.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Traer todos los issues que matchean la query (paginado, Search API)
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

    if (!res.ok) {
      throw new Error(`GitHub Search API respondió ${res.status}: ${await res.text()}`);
    }

    const json = await res.json();
    for (const item of json.items) {
      // La Search API de issues devuelve también Pull Requests; se filtran.
      if (item.pull_request) continue;
      issues.push({
        number: item.number,
        title: item.title,
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

// ---------------------------------------------------------------------------
// 2. Cálculos
// ---------------------------------------------------------------------------

function pct(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function computeResumen(issues) {
  const abiertos = issues.filter((i) => i.state === "open").length;
  const cerrados = issues.filter((i) => i.state === "closed").length;
  const total = issues.length;

  const tiemposResolucionDias = issues
    .filter((i) => i.state === "closed" && i.closedAt)
    .map((i) => (i.closedAt - i.createdAt) / (1000 * 60 * 60 * 24));

  const promedio = tiemposResolucionDias.length
    ? tiemposResolucionDias.reduce((a, b) => a + b, 0) / tiemposResolucionDias.length
    : null;

  const mediana = (() => {
    if (!tiemposResolucionDias.length) return null;
    const sorted = [...tiemposResolucionDias].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  })();

  return {
    total,
    abiertos,
    cerrados,
    pctResueltos: pct(cerrados, total),
    promedioDias: promedio != null ? promedio.toFixed(1) : "—",
    medianaDias: mediana != null ? mediana.toFixed(1) : "—",
  };
}

// Devuelve el lunes de la semana que contiene `date` (ISO week start).
function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=domingo .. 6=sábado
  const diff = (day === 0 ? -6 : 1) - day; // ajustar para que la semana empiece lunes
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatFechaCorta(date) {
  return date.toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" });
}

function computeTendenciaSemanal(issues, semanas) {
  const hoy = new Date();
  const inicioSemanaActual = startOfWeek(hoy);

  const bins = [];
  for (let i = semanas - 1; i >= 0; i--) {
    const inicio = new Date(inicioSemanaActual);
    inicio.setDate(inicio.getDate() - i * 7);
    bins.push({ inicio, abiertos: 0, cerrados: 0 });
  }

  const primerBinInicio = bins[0].inicio;

  for (const issue of issues) {
    if (issue.createdAt >= primerBinInicio) {
      const semanaCreado = startOfWeek(issue.createdAt).getTime();
      const bin = bins.find((b) => b.inicio.getTime() === semanaCreado);
      if (bin) bin.abiertos += 1;
    }
    if (issue.closedAt && issue.closedAt >= primerBinInicio) {
      const semanaCerrado = startOfWeek(issue.closedAt).getTime();
      const bin = bins.find((b) => b.inicio.getTime() === semanaCerrado);
      if (bin) bin.cerrados += 1;
    }
  }

  return bins;
}

// ---------------------------------------------------------------------------
// 3. Generar markdown para cada bloque AUTO
// ---------------------------------------------------------------------------

function renderResumen(resumen, fechaHoy) {
  return `| Métrica | Valor |
|---|---|
| Total de bugs registrados | ${resumen.total} |
| **Abiertos** | **${resumen.abiertos}** |
| **Cerrados** | **${resumen.cerrados}** |
| % Resueltos | ${resumen.pctResueltos} |
| Tiempo promedio de resolución | ${resumen.promedioDias} días |
| Tiempo mediana de resolución | ${resumen.medianaDias} días |

> Última actualización automática: \`${fechaHoy}\` — generado desde GitHub Issues por GitHub Action.`;
}

function renderTendenciaChart(bins) {
  const labels = bins.map((b) => `"${formatFechaCorta(b.inicio)}"`).join(", ");
  const abiertos = bins.map((b) => b.abiertos).join(", ");
  const cerrados = bins.map((b) => b.cerrados).join(", ");
  const maxY = Math.max(1, ...bins.map((b) => Math.max(b.abiertos, b.cerrados))) + 1;

  return `%%{init: {'theme':'base', 'themeVariables': {
  'xyChart': {
    'backgroundColor': '#1a202c',
    'titleColor': '#ffffff',
    'xAxisLabelColor': '#e6e6e6',
    'xAxisTitleColor': '#e6e6e6',
    'xAxisTickColor': '#a0aec0',
    'xAxisLineColor': '#a0aec0',
    'yAxisLabelColor': '#e6e6e6',
    'yAxisTitleColor': '#e6e6e6',
    'yAxisTickColor': '#a0aec0',
    'yAxisLineColor': '#a0aec0',
    'plotColorPalette': '#e05263, #4ea8de'
  }
}}}%%
xychart-beta
    title "Bugs abiertos vs. cerrados por semana"
    x-axis [${labels}]
    y-axis "Cantidad de bugs" 0 --> ${maxY}
    bar "Abiertos" [${abiertos}]
    bar "Cerrados" [${cerrados}]`;
}

function renderTendenciaTablaFallback(bins) {
  const rows = bins
    .map((b) => `| ${formatFechaCorta(b.inicio)} | ${b.abiertos} | ${b.cerrados} |`)
    .join("\n");
  return `| Semana (inicio) | Abiertos | Cerrados |
|---|:---:|:---:|
${rows}`;
}

// ---------------------------------------------------------------------------
// 4. Reemplazar bloques marcados en el archivo
// ---------------------------------------------------------------------------

function replaceBlock(content, marker, newInner) {
  const start = `<!-- AUTO:${marker}:start -->`;
  const end = `<!-- AUTO:${marker}:end -->`;
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!re.test(content)) {
    console.warn(`⚠️  No se encontró el marcador "${marker}" en el dashboard. Se omite.`);
    return content;
  }
  return content.replace(re, `${start}\n${newInner}\n${end}`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));

  let owner = config.owner;
  let repo = config.repo;
  if ((!owner || !repo) && process.env.GITHUB_REPOSITORY) {
    [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  }
  if (!owner || !repo) {
    console.error("No se pudo determinar owner/repo. Completá scripts/github-bugs-config.json.");
    process.exit(1);
  }

  const issues = await fetchAllBugIssues(owner, repo, config.query);
  const resumen = computeResumen(issues);
  const bins = computeTendenciaSemanal(issues, config.semanasATrackear);
  const fechaHoy = new Date().toISOString().slice(0, 10).split("-").reverse().join("/");

  let content = await fs.readFile(DASHBOARD_PATH, "utf-8");
  content = replaceBlock(content, "resumen-bugs", renderResumen(resumen, fechaHoy));
  content = replaceBlock(content, "tendencia-bugs-chart", renderTendenciaChart(bins));
  content = replaceBlock(content, "tendencia-bugs-tabla", renderTendenciaTablaFallback(bins));

  await fs.writeFile(DASHBOARD_PATH, content, "utf-8");
  console.log(`✅ Dashboard de bugs actualizado (${owner}/${repo}).`);
}

main().catch((err) => {
  console.error("❌ Error actualizando el dashboard de bugs:", err);
  process.exit(1);
});
