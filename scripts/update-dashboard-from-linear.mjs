// scripts/update-dashboard-from-linear.mjs
//
// Consulta issues en Linear vía su API GraphQL, calcula story points
// completados / % de avance por capa, y reescribe las secciones marcadas
// con <!-- AUTO:...:start/end --> en el dashboard.md.
//
// Los totales (Story Points e Historias de Usuario) se recalculan en cada
// corrida a partir de TODOS los issues que existan en Linear en ese momento,
// para reflejar automáticamente historias agregadas después del kickoff
// (no dependen del número fijo de planning original).
//
// Requiere Node 18+ (usa fetch nativo).
//
// Variables de entorno requeridas:
//   LINEAR_API_KEY   -> API key personal o de integración de Linear
//   LINEAR_TEAM_KEY  -> key del equipo en Linear (ej: "BIST")
//
// Uso local:
//   LINEAR_API_KEY=xxx LINEAR_TEAM_KEY=BIST node scripts/update-dashboard-from-linear.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DASHBOARD_PATH = path.join(ROOT, "dashboard-avance-edt.md");
const CONFIG_PATH = path.join(__dirname, "sprint-config.json");

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const LINEAR_TEAM_KEY = process.env.LINEAR_TEAM_KEY;

if (!LINEAR_API_KEY || !LINEAR_TEAM_KEY) {
  console.error("Faltan LINEAR_API_KEY y/o LINEAR_TEAM_KEY en el entorno.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Traer todos los issues del equipo desde Linear (paginado)
// ---------------------------------------------------------------------------

const QUERY = `
  query Issues($teamKey: String!, $after: String) {
    issues(
      first: 100
      after: $after
      filter: { team: { key: { eq: $teamKey } } }
    ) {
      nodes {
        id
        title
        estimate
        state { name type }
        cycle { number }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

async function fetchAllIssues() {
  const issues = [];
  let after = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: LINEAR_API_KEY,
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { teamKey: LINEAR_TEAM_KEY, after },
      }),
    });

    if (!res.ok) {
      throw new Error(`Linear API respondió ${res.status}: ${await res.text()}`);
    }

    const json = await res.json();
    if (json.errors) {
      throw new Error(`Linear API error: ${JSON.stringify(json.errors)}`);
    }

    const page = json.data.issues;
    for (const n of page.nodes) {
      // Se excluyen los issues cancelados: no forman parte del alcance real.
      if (n.state?.type === "canceled") continue;
      issues.push({
        title: n.title,
        estimate: n.estimate ?? 0,
        stateType: n.state?.type ?? "unknown", // backlog | unstarted | started | completed
        cycleNumber: n.cycle?.number ?? null,
      });
    }

    hasNextPage = page.pageInfo.hasNextPage;
    after = page.pageInfo.endCursor;
  }

  return issues;
}

// ---------------------------------------------------------------------------
// 2. Cálculos
// ---------------------------------------------------------------------------

function isCompleted(issue) {
  return issue.stateType === "completed";
}

function pct(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function computeResumen(issues, config) {
  // Totales dinámicos: reflejan el alcance ACTUAL en Linear, incluyendo
  // historias agregadas después del kickoff (no solo las 26/202 de planning).
  const totalHistoriasUsuario = issues.length;
  const totalStoryPoints = issues.reduce((a, i) => a + i.estimate, 0);
  const spCompletados = issues.filter(isCompleted).reduce((a, i) => a + i.estimate, 0);

  const sprintsConIssues = issues.map((i) => i.cycleNumber).filter(Boolean);
  const sprintActual = sprintsConIssues.length ? Math.max(...sprintsConIssues) : "—";

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
  };
}

function computeCapas(issues, config) {
  const capas = config.capas.map((capa) => {
    const issuesCapa = issues.filter((i) => capa.sprints.includes(i.cycleNumber));
    const huCompletadas = issuesCapa.filter(isCompleted).length;
    const huTotales = issuesCapa.length;
    const spCapa = issuesCapa.reduce((a, i) => a + i.estimate, 0);
    return {
      ...capa,
      huTotales,
      spCapa,
      huCompletadas,
      pctAvance: pct(huCompletadas, huTotales),
    };
  });

  const totalHu = capas.reduce((a, c) => a + c.huTotales, 0);
  const totalSp = capas.reduce((a, c) => a + c.spCapa, 0);
  const totalHuCompletadas = capas.reduce((a, c) => a + c.huCompletadas, 0);

  return {
    capas,
    total: {
      huTotales: totalHu,
      spTotal: totalSp,
      huCompletadas: totalHuCompletadas,
      pctAvance: pct(totalHuCompletadas, totalHu),
    },
  };
}

function computeSpPorSprint(issues, config) {
  const nSprints = config.storyPointsPlanificadosPorSprint.length;
  const completadoPorSprint = Array(nSprints).fill(0);
  for (const issue of issues) {
    if (isCompleted(issue) && issue.cycleNumber && issue.cycleNumber <= nSprints) {
      completadoPorSprint[issue.cycleNumber - 1] += issue.estimate;
    }
  }
  return completadoPorSprint;
}

// ---------------------------------------------------------------------------
// 3. Generar markdown para cada bloque AUTO
// ---------------------------------------------------------------------------

function renderResumen(resumen, fechaHoy) {
  const notaScope = resumen.scopeCambio
    ? `\n\n> ℹ️ El alcance actual (${resumen.totalHistoriasUsuario} HU / ${resumen.totalStoryPoints} pts) difiere de la línea base de planning (${resumen.baseline.totalHistoriasUsuario} HU / ${resumen.baseline.totalStoryPoints} pts) — se agregaron o quitaron historias después del kickoff.`
    : "";

  return `| Métrica | Valor |
|---|---|
| Período del proyecto | 03/08/2026 – 10/12/2026 |
| Sprints planificados | 9 Sprints (2 semanas c/u) + ciclo de cierre |
| Historias de Usuario totales (actual) | ${resumen.totalHistoriasUsuario} |
| Story Points totales (actual) | ${resumen.totalStoryPoints} pts |
| **Sprint actual** | **${resumen.sprintActual}** |
| **Story Points completados a la fecha** | **${resumen.spCompletados}** |
| **% Avance global** | **${resumen.pctAvanceGlobal}** |

> Última actualización automática: \`${fechaHoy}\` — generado desde Linear por GitHub Action.${notaScope}`;
}

function renderCapas({ capas, total }) {
  const rows = capas
    .map(
      (c) =>
        `| ${c.emoji} ${c.nombre} | ${c.sprints[0]}–${c.sprints[c.sprints.length - 1]} | ${c.huTotales} | ${c.spCapa} | ${c.huCompletadas} | ${c.pctAvance} |`
    )
    .join("\n");
  return `| Capa | Sprints | HU totales | Story Points | HU completadas | % Avance |
|---|---|---|---|---|---|
${rows}
| **Total** | **1–9** | **${total.huTotales}** | **${total.spTotal}** | **${total.huCompletadas}** | **${total.pctAvance}** |`;
}

function renderSpPorSprintChart(planificado, completado) {
  const labels = planificado.map((_, i) =>
    i === planificado.length - 1 ? `"Sprint${i + 1}(cond)"` : `Sprint${i + 1}`
  );
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
    title "Story Points planificados vs. completados por Sprint"
    x-axis [${labels.join(", ")}]
    y-axis "Story Points" 0 --> 50
    bar "Planificado" [${planificado.join(", ")}]
    bar "Completado" [${completado.join(", ")}]`;
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
  const issues = await fetchAllIssues();

  const resumen = computeResumen(issues, config);
  const capasResult = computeCapas(issues, config);
  const spCompletadoPorSprint = computeSpPorSprint(issues, config);
  const fechaHoy = new Date().toISOString().slice(0, 10).split("-").reverse().join("/");

  let content = await fs.readFile(DASHBOARD_PATH, "utf-8");
  content = replaceBlock(content, "resumen-ejecutivo", renderResumen(resumen, fechaHoy));
  content = replaceBlock(content, "avance-por-capa", renderCapas(capasResult));
  content = replaceBlock(
    content,
    "sp-por-sprint-chart",
    renderSpPorSprintChart(config.storyPointsPlanificadosPorSprint, spCompletadoPorSprint)
  );

  await fs.writeFile(DASHBOARD_PATH, content, "utf-8");
  console.log("✅ Dashboard actualizado desde Linear.");
}

main().catch((err) => {
  console.error("❌ Error actualizando el dashboard:", err);
  process.exit(1);
});
