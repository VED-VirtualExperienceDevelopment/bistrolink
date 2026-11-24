// scripts/dashboards/update-dashboard-from-linear.mjs
//
// Reescribe los bloques <!-- AUTO:...:start/end --> de
// docs/dashboard-avance-edt.md con el avance calculado desde Linear.
//
// BL-493: el avance se mide contra el backlog, no contra todo lo que hay en
// Linear. backlog-hu.json dice qué historias forman el MVP (Anexo 5
// v2.3 más las solicitudes de cambio) y sprint-config.json trae el
// calendario y el plan de la Línea de Base (Tabla 17). El trabajo técnico se
// muestra aparte, como throughput. El cálculo vive en avance-mvp.mjs, que
// también usa el email de estado.
//
// Requiere Node 18+ (usa fetch nativo).
//
// Variables de entorno requeridas:
//   LINEAR_API_KEY   -> API key personal o de integración de Linear
//   LINEAR_TEAM_KEY  -> key del equipo en Linear
//
// Uso local:
//   LINEAR_API_KEY=xxx LINEAR_TEAM_KEY=VED node scripts/dashboards/update-dashboard-from-linear.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  calcularAvance,
  fechaCorta,
  leerConfiguracion,
  porcentaje,
  topeEje,
  traerIssuesDeLinear,
} from "./avance-mvp.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_PATH = path.join(__dirname, "..", "..", "docs", "dashboard-avance-edt.md");

// ---------------------------------------------------------------------------
// Utilidades de formato
// ---------------------------------------------------------------------------

const NIVELES = { 1: "Comprometida", 2: "Salida controlada", 3: "Condicional", 4: "Futuro" };

function celda(texto) {
  return String(texto ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function conSigno(n) {
  return n > 0 ? `+${n}` : String(n);
}

function fechaLarga(iso) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

// ---------------------------------------------------------------------------
// Bloques
// ---------------------------------------------------------------------------

export function renderResumen(av, backlog, config) {
  const { lineaDeBase, sprints } = config;
  const cierre = sprints.at(-1);
  const cambios = backlog.alcance.solicitudesDeCambio;
  const spCambios = cambios.reduce((a, c) => a + c.storyPoints, 0);
  const detalleAlcance = cambios.length
    ? ` (backlog: ${backlog.alcance.historias} HU / ${backlog.alcance.storyPoints} SP + ${cambios.length} solicitud${cambios.length > 1 ? "es" : ""} de cambio: ${spCambios} SP)`
    : "";

  let sprintActual = "—";
  if (av.terminoTodo) sprintActual = "Proyecto entregado";
  else if (av.sprintActual) {
    const s = av.sprintActual;
    sprintActual = `**${s.nombre}** (${fechaCorta(s.inicio)} – ${fechaCorta(s.fin)} · ${s.hito})`;
  } else sprintActual = `Empieza el ${fechaLarga(sprints[0].inicio)}`;

  const must = av.porPrioridad.find((p) => p.prioridad === "Must");

  const filas = [
    ["Período (Línea de Base)", `${fechaLarga(lineaDeBase.inicio)} – ${fechaLarga(lineaDeBase.entrega)}`],
    [
      "Plan",
      `${sprints.length - 1} Sprints de 2 semanas + semana de cierre (${fechaCorta(cierre.inicio)} – ${fechaCorta(cierre.fin)})`,
    ],
    ["**Sprint actual**", sprintActual],
    ["Alcance del MVP", `${av.mvp.hu} HU · ${av.mvp.sp} SP${detalleAlcance}`],
    ["**HU del MVP terminadas**", `**${av.mvp.huTerminadas} de ${av.mvp.hu}**`],
    ["**SP del MVP terminados**", `**${av.mvp.spTerminados} de ${av.mvp.sp} (${av.mvp.pct} %)**`],
    ["Must terminados", `${must.spTerminados} de ${must.sp} SP (${must.pct} %)`],
  ];

  if (av.sprintsCerrados) {
    const ultimo = sprints[av.sprintsCerrados - 1];
    const realAlCierre = av.burnup.real[av.sprintsCerrados - 1] ?? av.mvp.spTerminados;
    filas.push([
      `Plan de la Línea de Base al cierre de ${ultimo.nombre}`,
      `${av.planALaFecha} SP · real ${realAlCierre} SP (${conSigno(realAlCierre - av.planALaFecha)} SP)`,
    ]);
  }

  const tp = av.throughput.reduce(
    (a, t) => ({ historias: a.historias + t.historias, tecnico: a.tecnico + t.tecnico, issues: a.issues + t.issues }),
    { historias: 0, tecnico: 0, issues: 0 }
  );
  const totalTp = tp.historias + tp.tecnico;
  filas.push([
    "Trabajo cerrado en Linear (todo el proyecto)",
    `${tp.issues} issues · ${totalTp} SP: ${tp.historias} de historias y ${tp.tecnico} técnicos (${porcentaje(tp.tecnico, totalTp)} %)`,
  ]);

  return `| Métrica | Valor |
|---|---|
${filas.map(([m, v]) => `| ${m} | ${v} |`).join("\n")}

> Última actualización automática: \`${fechaLarga(av.hoy)}\` — generado desde Linear por GitHub Action. El avance cuenta solo las historias del MVP (\`scripts/dashboards/backlog-hu.json\`); el trabajo técnico se muestra aparte, en «Trabajo cerrado por Sprint».`;
}

export function renderGrupos(av, config) {
  const ultimoSprint = config.sprints.at(-2);
  const filas = av.grupos.map((g) => {
    const cumplido = g.fechaReal
      ? `✅ ${fechaCorta(g.fechaReal)}`
      : `Falta${g.hu - g.huTerminadas > 1 ? "n" : ""} ${g.hu - g.huTerminadas} HU`;
    return `| ${g.emoji} ${g.nombre} | ${g.huTerminadas}/${g.hu} | ${g.spTerminados}/${g.sp} | ${g.pct} % | ${fechaCorta(g.fechaPlan)} (${g.hito}) | ${cumplido} |`;
  });
  const t = av.mvp;
  return `| Grupo del backlog | HU terminadas | SP terminados | % SP | Plan | Cumplido |
|---|---|---|---|---|---|
${filas.join("\n")}
| **Total MVP** | **${t.huTerminadas}/${t.hu}** | **${t.spTerminados}/${t.sp}** | **${t.pct} %** | **${fechaCorta(ultimoSprint.fin)} (${ultimoSprint.hito})** | |`;
}

export function renderBurnup(av) {
  const { etiquetas, plan, real, alcance, planLineaDeBase } = av.burnup;
  const barras = real.map((v) => v ?? 0);
  const lineaAlcance = etiquetas.map(() => alcance);
  const tope = topeEje(plan, barras, lineaAlcance);
  return `\`\`\`mermaid
xychart-beta
    x-axis "Sprint" [${etiquetas.map((e) => `"${e}"`).join(", ")}]
    y-axis "Story Points del MVP" 0 --> ${tope}
    bar "Real acumulado" [${barras.join(", ")}]
    line "Plan de la Línea de Base" [${plan.join(", ")}]
    line "Alcance vigente" [${lineaAlcance.join(", ")}]
\`\`\`

> **Cómo leerlo.** Barras: SP de historias del MVP terminadas, acumulados al cierre de cada Sprint (los Sprints que no empezaron quedan vacíos). Línea que sube: plan de la Línea de Base (Tabla 17), que cubría ${planLineaDeBase} SP. Línea horizontal: alcance vigente, ${alcance} SP; la diferencia con el plan son las historias incorporadas después de la Línea de Base y las solicitudes de cambio.`;
}

export function renderPrioridad(av) {
  const filas = av.porPrioridad.map(
    (p) => `| ${p.prioridad} | ${p.huTerminadas}/${p.hu} | ${p.spTerminados}/${p.sp} | ${p.pct} % |`
  );
  const must = av.porPrioridad.find((p) => p.prioridad === "Must");
  const should = av.porPrioridad.find((p) => p.prioridad === "Should");
  const pendientes = av.mvp.sp - av.mvp.spTerminados;
  const porciones = [
    [`Must terminados (${must.spTerminados})`, must.spTerminados],
    [`Should terminados (${should.spTerminados})`, should.spTerminados],
    [`Pendientes (${pendientes})`, pendientes],
  ].filter(([, v]) => v > 0);

  return `| Prioridad | HU terminadas | SP terminados | % SP |
|---|---|---|---|
${filas.join("\n")}

\`\`\`mermaid
pie title Story Points del MVP (${av.mvp.sp} SP)
${porciones.map(([n, v]) => `    "${n}" : ${v}`).join("\n")}
\`\`\`

> La prioridad es la del backlog (Anexo 5), no la etiqueta de Linear: por ejemplo, HU-012 es Must desde la Línea de Base.`;
}

export function renderHitos(av, config) {
  const filas = config.sprints.map((s, i) => {
    const plan = av.burnup.plan[i];
    const real = av.burnup.real[i];
    let realTxt = "—";
    let desvio = "—";
    if (real != null && i < av.sprintsCerrados) {
      realTxt = String(real);
      desvio = `${conSigno(real - plan)} SP`;
    } else if (real != null) {
      realTxt = `${real} (en curso)`;
    }
    return `| ${s.hito} | ${s.nombre} · ${fechaCorta(s.fin)} | ${s.spPlan} | ${plan} | ${realTxt} | ${desvio} |`;
  });
  return `| Hito | Sprint · cierre | SP plan del Sprint | Plan acumulado | Real acumulado | Desvío |
|---|---|---|---|---|---|
${filas.join("\n")}

> Plan: Línea de Base, Tabla 17 (S1–S4 reales y S5–S8 planificados al 28/09). Real: SP del backlog vigente de las historias terminadas hasta el cierre de cada Sprint, según la fecha en que se cerró en Linear su último issue.`;
}

export function renderPendientes(av) {
  const pendientes = av.historias
    .filter((h) => !h.terminada)
    .sort((a, b) => a.prioridad.localeCompare(b.prioridad) || a.nivel - b.nivel || a.hu.localeCompare(b.hu));
  if (!pendientes.length) return "✅ Todas las historias del MVP están terminadas.";
  const filas = pendientes.map(
    (h) =>
      `| ${h.hu} | ${celda(h.titulo)} | ${h.prioridad} | ${NIVELES[h.nivel] ?? "—"} | ${h.sp} | ${celda(h.estado)} | ${h.linear.join(", ")} |`
  );
  const sp = pendientes.reduce((a, h) => a + h.sp, 0);
  return `| HU | Historia | Prioridad | Nivel | SP | Estado en Linear | Issues |
|---|---|---|---|---|---|---|
${filas.join("\n")}

> ${pendientes.length} historias pendientes, ${sp} SP. «Salida controlada» (nivel 2): salen del MVP en el orden de la Línea de Base §3.4.1 si la velocidad no alcanza.`;
}

export function renderThroughput(av, config) {
  const etiquetas = config.sprints.map((s) => `"${s.nombre}"`);
  const total = av.throughput.map((t) => t.historias + t.tecnico);
  const historias = av.throughput.map((t) => t.historias);
  const tope = topeEje(total);
  const filas = av.throughput.map(
    (t) =>
      `| ${t.sprint} | ${t.issuesHistorias} | ${t.issuesTecnicos} | ${t.historias} | ${t.tecnico} | ${t.historias + t.tecnico} | ${porcentaje(t.tecnico, t.historias + t.tecnico)} % |`
  );
  return `\`\`\`mermaid
xychart-beta
    x-axis "Sprint" [${etiquetas.join(", ")}]
    y-axis "Story Points cerrados" 0 --> ${tope}
    bar "Trabajo técnico" [${total.join(", ")}]
    bar "Historias" [${historias.join(", ")}]
\`\`\`

> **Cómo leerlo.** Las barras están apiladas: violeta, SP de historias de usuario (la HU o sus sub-issues); dorado, encima, SP de trabajo técnico (pipeline, seguridad, testing, defectos, documentación). Cuenta todo lo cerrado en Linear, también lo que está fuera del MVP; los sub-issues con estimación propia suman además de su HU. Los issues sin estimación suman 0 SP (en los primeros Sprints el trabajo técnico casi no se estimaba): por eso la tabla muestra también la cantidad de issues.

| Sprint | Issues de historias | Issues técnicos | SP historias | SP técnicos | SP total | % técnico (SP) |
|---|---|---|---|---|---|---|
${filas.join("\n")}`;
}

export function renderFuera(av) {
  const filas = av.fuera.map(
    (h) => `| ${h.hu ?? "—"} | ${celda(h.titulo)} | ${h.prioridad} | ${h.sp} | ${celda(h.motivo)} | ${celda(h.estado)} | ${h.linear.join(", ")} |`
  );
  return `| HU | Historia | Prioridad | SP | Motivo | Estado en Linear | Issues |
|---|---|---|---|---|---|---|
${filas.join("\n")}

> No cuentan para el avance del MVP. Lo que se cerró de estas historias aparece en el throughput como trabajo de historias.`;
}

export function renderAvisos(av) {
  if (!av.avisos.length) return "✅ `backlog-hu.json` y Linear coinciden: no hay historias sin mapear ni issues faltantes.";
  return `⚠️ Revisar \`scripts/dashboards/backlog-hu.json\`:

${av.avisos.map((a) => `- ${celda(a)}`).join("\n")}`;
}

// ---------------------------------------------------------------------------
// Reemplazo de bloques
// ---------------------------------------------------------------------------

export function reemplazarBloque(contenido, marcador, interior) {
  const inicio = `<!-- AUTO:${marcador}:start -->`;
  const fin = `<!-- AUTO:${marcador}:end -->`;
  const re = new RegExp(`${inicio}[\\s\\S]*?${fin}`);
  if (!re.test(contenido)) {
    console.warn(`⚠️  No se encontró el marcador "${marcador}" en el dashboard. Se omite.`);
    return contenido;
  }
  // Función de reemplazo: el interior puede traer "$" y no debe interpretarse.
  return contenido.replace(re, () => `${inicio}\n\n${interior}\n\n${fin}`);
}

export function renderDashboard(contenido, av, backlog, config) {
  const bloques = {
    "resumen-ejecutivo": renderResumen(av, backlog, config),
    "avance-por-grupo": renderGrupos(av, config),
    "burnup-mvp": renderBurnup(av),
    "avance-por-prioridad": renderPrioridad(av),
    "hitos-plan-vs-real": renderHitos(av, config),
    "historias-pendientes": renderPendientes(av),
    "throughput-por-sprint": renderThroughput(av, config),
    "fuera-del-mvp": renderFuera(av),
    "control-del-backlog": renderAvisos(av),
  };
  return Object.entries(bloques).reduce((c, [m, interior]) => reemplazarBloque(c, m, interior), contenido);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const { LINEAR_API_KEY, LINEAR_TEAM_KEY } = process.env;
  if (!LINEAR_API_KEY || !LINEAR_TEAM_KEY) {
    console.error("Faltan LINEAR_API_KEY y/o LINEAR_TEAM_KEY en el entorno.");
    process.exit(1);
  }

  const { backlog, config } = await leerConfiguracion();
  const issues = await traerIssuesDeLinear({ apiKey: LINEAR_API_KEY, teamKey: LINEAR_TEAM_KEY });
  const av = calcularAvance({ issues, backlog, config });

  // Los avisos también salen como anotaciones en el resumen del workflow.
  for (const a of av.avisos) console.log(`::warning title=backlog-hu.json::${a}`);

  const contenido = await fs.readFile(DASHBOARD_PATH, "utf-8");
  await fs.writeFile(DASHBOARD_PATH, renderDashboard(contenido, av, backlog, config), "utf-8");
  console.log(
    `✅ Dashboard actualizado: ${av.mvp.huTerminadas}/${av.mvp.hu} HU, ${av.mvp.spTerminados}/${av.mvp.sp} SP del MVP (${av.mvp.pct} %).`
  );
}

// Solo corre main() si se ejecuta directamente (los tests importan las funciones).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("❌ Error actualizando el dashboard:", err);
    process.exit(1);
  });
}
