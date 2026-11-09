// scripts/dashboards/avance-mvp.mjs
//
// BL-493: cálculo del avance del proyecto, compartido por el dashboard de
// avance (update-dashboard-from-linear.mjs) y el email de estado
// (send-status-email.mjs), para que los dos muestren los mismos números.
//
// Separa dos cosas que antes se mezclaban:
//   - Avance del MVP: solo las historias del backlog (backlog-hu.json),
//     con sus SP y prioridad del Anexo 5. Una HU está terminada cuando todos
//     sus issues de Linear están Done.
//   - Throughput: todo lo cerrado en Linear por Sprint, dividido entre trabajo
//     de historias (la HU o sus sub-issues) y trabajo técnico (pipeline,
//     seguridad, testing, defectos, documentación).
//
// El calendario y el plan son los de la Línea de Base (sprint-config.json).
// Las funciones de cálculo no hacen I/O: se prueban con avance-mvp.test.mjs.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKLOG_PATH = path.join(__dirname, "backlog-hu.json");
export const CONFIG_PATH = path.join(__dirname, "sprint-config.json");

export async function leerConfiguracion() {
  const [backlog, config] = await Promise.all([
    fs.readFile(BACKLOG_PATH, "utf-8").then(JSON.parse),
    fs.readFile(CONFIG_PATH, "utf-8").then(JSON.parse),
  ]);
  return { backlog, config };
}

// ---------------------------------------------------------------------------
// 1. Linear
// ---------------------------------------------------------------------------

// Se traen también los cancelados: un issue de una HU que aparece cancelado
// tiene que avisarse, no desaparecer en silencio. Los archivados no vienen.
const QUERY = `
  query Issues($teamKey: String!, $after: String) {
    issues(
      first: 100
      after: $after
      filter: { team: { key: { eq: $teamKey } } }
    ) {
      nodes {
        identifier
        title
        estimate
        completedAt
        state { name type }
        parent { identifier }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function traerIssuesDeLinear({ apiKey, teamKey, fetchImpl = fetch }) {
  const issues = [];
  let after = null;
  let hayMas = true;

  while (hayMas) {
    const res = await fetchImpl("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({ query: QUERY, variables: { teamKey, after } }),
    });
    if (!res.ok) throw new Error(`Linear API respondió ${res.status}: ${await res.text()}`);

    const json = await res.json();
    if (json.errors) throw new Error(`Linear API error: ${JSON.stringify(json.errors)}`);

    const pagina = json.data.issues;
    for (const n of pagina.nodes) {
      issues.push({
        id: n.identifier,
        titulo: n.title,
        sp: n.estimate ?? 0,
        estado: n.state?.name ?? "—",
        tipo: n.state?.type ?? "unknown", // backlog | unstarted | started | completed | canceled
        completado: n.completedAt ?? null,
        padre: n.parent?.identifier ?? null,
      });
    }
    hayMas = pagina.pageInfo.hasNextPage;
    after = pagina.pageInfo.endCursor;
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 2. Utilidades
// ---------------------------------------------------------------------------

export function porcentaje(parte, total) {
  if (!total) return 0;
  return Math.round((parte / total) * 100);
}

// Fecha (AAAA-MM-DD) en la hora local del proyecto. Linear devuelve UTC: un
// issue cerrado a las 23:00 de Uruguay ya es el día siguiente en UTC.
export function fechaLocal(fecha, zonaHoras = -3) {
  const ms = new Date(fecha).getTime() + zonaHoras * 3600 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function fechaCorta(iso) {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

// Sprint al que pertenece una fecha: el último cuyo inicio ya pasó. Lo cerrado
// antes del S1 cuenta en el S1; lo cerrado en el fin de semana, en el Sprint
// que terminó el viernes.
export function indiceSprint(fecha, sprints) {
  let indice = 0;
  sprints.forEach((s, i) => {
    if (fecha >= s.inicio) indice = i;
  });
  return indice;
}

// Tope del eje Y: el máximo de los datos más un 10 %, redondeado a decenas.
export function topeEje(...series) {
  const max = Math.max(0, ...series.flat().filter((v) => typeof v === "number"));
  return Math.max(10, Math.ceil((max * 1.1) / 10) * 10);
}

const RE_HU = /^HU\b/i;

// ---------------------------------------------------------------------------
// 3. Cálculo
// ---------------------------------------------------------------------------

function evaluarHistoria(h, porId, config) {
  const zona = config.lineaDeBase.zonaHorariaHoras;
  const issues = h.linear.map((id) => porId.get(id));
  const encontrados = issues.filter(Boolean);
  const faltantes = h.linear.filter((id) => !porId.has(id));
  const cancelados = encontrados.filter((i) => i.tipo === "canceled").map((i) => i.id);
  const vigentes = encontrados.filter((i) => i.tipo !== "canceled");

  const terminada = faltantes.length === 0 && vigentes.length > 0 && vigentes.every((i) => i.tipo === "completed");
  const fechaFin = terminada
    ? vigentes
        .map((i) => (i.completado ? fechaLocal(i.completado, zona) : null))
        .filter(Boolean)
        .sort()
        .at(-1) ?? null
    : null;
  const pendiente = vigentes.find((i) => i.tipo !== "completed");

  return {
    ...h,
    titulo: encontrados[0]?.titulo ?? "(no encontrada en Linear)",
    spLinear: encontrados[0]?.sp ?? null,
    terminada,
    fechaFin,
    sprintFin: fechaFin ? indiceSprint(fechaFin, config.sprints) : null,
    estado: terminada ? "Terminada" : (pendiente?.estado ?? "No encontrada"),
    faltantes,
    cancelados,
  };
}

function resumir(historias) {
  const terminadas = historias.filter((h) => h.terminada);
  const sp = historias.reduce((a, h) => a + h.sp, 0);
  const spTerminados = terminadas.reduce((a, h) => a + h.sp, 0);
  return {
    hu: historias.length,
    huTerminadas: terminadas.length,
    sp,
    spTerminados,
    pct: porcentaje(spTerminados, sp),
  };
}

export function calcularAvance({ issues, backlog, config, hoy = new Date() }) {
  const zona = config.lineaDeBase.zonaHorariaHoras;
  const sprints = config.sprints;
  const fechaHoy = fechaLocal(hoy, zona);
  const porId = new Map(issues.map((i) => [i.id, i]));
  const avisos = [];

  // --- Sprint actual -------------------------------------------------------
  const empezo = fechaHoy >= sprints[0].inicio;
  const terminoTodo = fechaHoy > sprints.at(-1).fin;
  const indiceActual = empezo ? indiceSprint(fechaHoy, sprints) : null;
  const sprintActual = indiceActual == null ? null : { indice: indiceActual, ...sprints[indiceActual] };
  // Sprints cuyo último día ya pasó (para comparar contra el plan).
  const sprintsCerrados = sprints.filter((s) => s.fin < fechaHoy).length;

  // --- Historias del MVP -----------------------------------------------------
  const historias = backlog.historias.map((h) => evaluarHistoria(h, porId, config));
  const fuera = backlog.fueraDelMvp.map((h) => evaluarHistoria(h, porId, config));

  for (const h of [...historias, ...fuera]) {
    const nombre = h.hu ?? h.linear[0];
    if (h.faltantes.length) avisos.push(`${nombre}: ${h.faltantes.join(", ")} no aparece en Linear (¿archivado o mal escrito en backlog-hu.json?).`);
    if (h.cancelados.length) avisos.push(`${nombre}: ${h.cancelados.join(", ")} está cancelado en Linear; no cuenta para el avance.`);
  }
  for (const h of historias) {
    if (h.spLinear != null && h.spLinear !== h.sp) {
      avisos.push(`${h.hu}: ${h.linear[0]} tiene ${h.spLinear} SP en Linear y ${h.sp} en el backlog (se usa el backlog).`);
    }
  }

  const mvp = resumir(historias);
  const esperadoHu = backlog.alcance.historias + backlog.alcance.solicitudesDeCambio.length;
  const esperadoSp =
    backlog.alcance.storyPoints + backlog.alcance.solicitudesDeCambio.reduce((a, c) => a + c.storyPoints, 0);
  if (mvp.hu !== esperadoHu || mvp.sp !== esperadoSp) {
    avisos.push(
      `backlog-hu.json suma ${mvp.hu} HU y ${mvp.sp} SP, pero el alcance declarado es ${esperadoHu} HU y ${esperadoSp} SP.`
    );
  }

  const porPrioridad = ["Must", "Should"].map((p) => ({
    prioridad: p,
    ...resumir(historias.filter((h) => h.prioridad === p)),
  }));

  const grupos = backlog.grupos.map((g) => {
    const delGrupo = historias.filter((h) => h.grupo === g.id);
    const r = resumir(delGrupo);
    const cumplido = r.hu > 0 && r.huTerminadas === r.hu;
    return {
      ...g,
      ...r,
      fechaReal: cumplido ? delGrupo.map((h) => h.fechaFin).filter(Boolean).sort().at(-1) ?? null : null,
    };
  });

  // --- Burn-up -------------------------------------------------------------
  let acumPlan = 0;
  const plan = sprints.map((s) => (acumPlan += s.spPlan));
  const real = sprints.map((_, i) =>
    indiceActual != null && i <= indiceActual
      ? historias.filter((h) => h.terminada && h.sprintFin <= i).reduce((a, h) => a + h.sp, 0)
      : null
  );
  const planALaFecha = sprintsCerrados ? plan[sprintsCerrados - 1] : 0;

  // --- Throughput ----------------------------------------------------------
  const deHistorias = new Set([...backlog.historias, ...backlog.fueraDelMvp].flatMap((h) => h.linear));
  const reclasificados = new Set((backlog.reclasificados ?? []).map((r) => r.linear));
  const throughput = sprints.map((s) => ({
    sprint: s.nombre,
    historias: 0,
    tecnico: 0,
    issues: 0,
    issuesHistorias: 0,
    issuesTecnicos: 0,
  }));
  for (const i of issues) {
    if (i.tipo !== "completed" || !i.completado) continue;
    const fila = throughput[indiceSprint(fechaLocal(i.completado, zona), sprints)];
    fila.issues += 1;
    if (deHistorias.has(i.id) || (i.padre && deHistorias.has(i.padre))) {
      fila.historias += i.sp;
      fila.issuesHistorias += 1;
    } else {
      fila.tecnico += i.sp;
      fila.issuesTecnicos += 1;
    }
  }

  // Issues que parecen historias y no están en el backlog: avisa para que se
  // agreguen (o se reclasifiquen) en backlog-hu.json.
  for (const i of issues) {
    if (i.tipo === "canceled" || !RE_HU.test(i.titulo)) continue;
    if (deHistorias.has(i.id) || reclasificados.has(i.id)) continue;
    if (i.padre && deHistorias.has(i.padre)) continue;
    avisos.push(`${i.id} «${i.titulo}» tiene «HU» en el título y no está en backlog-hu.json.`);
  }

  return {
    hoy: fechaHoy,
    empezo,
    terminoTodo,
    sprintActual,
    sprintsCerrados,
    historias,
    fuera,
    mvp,
    porPrioridad,
    grupos,
    burnup: { etiquetas: sprints.map((s) => s.nombre), plan, real, alcance: mvp.sp, planLineaDeBase: acumPlan },
    planALaFecha,
    throughput,
    avisos,
  };
}
