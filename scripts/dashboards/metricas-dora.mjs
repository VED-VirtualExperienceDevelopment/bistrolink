// scripts/dashboards/metricas-dora.mjs
//
// BL-221: métricas DORA de producción (Anexo 9 §10.2) para el dashboard
// «Calidad del proceso» (docs/dashboard-calidad-proceso.md). Llena los bloques
// <!-- AUTO:...:start/end --> de la plantilla en la copia del runner; el
// workflow «Publicar dashboards» la convierte a HTML. No se commitea nada.
//
// Fuentes (API REST de GitHub, con el GITHUB_TOKEN del workflow):
//   - Deployments del environment "production" y sus estados. Los crea el CI:
//     el job deploy-prod con el tag (vX.Y.Z) y el job rollback con la rama
//     desde la que se lanza (main).
//   - Comparación entre tags y los PR mergeados a develop, para el lead time.
//   - Jobs «Deploy staging» de las corridas del CI en develop: deploys a
//     staging por semana y duración del pipeline hasta staging (contexto).
//   - Issues con la etiqueta "incidente".
//
// Definiciones (Anexo 9 §10.2):
//   - Release: deploy exitoso a production de un tag vX.Y.Z. Los ensayos
//     (vX.Y.Z-rc.N) se muestran aparte y no cuentan para DORA.
//   - Frecuencia: releases por sprint (sprint-config.json) y por semana.
//   - Lead time: por cada PR que entró en un release, desde su primer commit
//     hasta el deploy en producción; separado en revisión (apertura → merge a
//     develop) y release (merge → producción). El primer release no se mide:
//     incluye todo el historial del proyecto y no es comparable.
//   - Tasa de fallas: releases que necesitaron un rollback de producción o un
//     hotfix (el release siguiente es un parche, vX.Y.Z con Z > 0).
//   - Tiempo de recuperación: desde el deploy del release fallido hasta el
//     rollback o el hotfix exitoso.
//
// Uso local (solo lectura):
//   $env:GITHUB_TOKEN="..."; $env:GITHUB_REPOSITORY="VED-VirtualExperienceDevelopment/bistrolink"
//   node scripts/dashboards/metricas-dora.mjs
//   git restore docs/dashboard-calidad-proceso.md

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DASHBOARD = path.join(ROOT, "docs", "dashboard-calidad-proceso.md");
const SPRINTS = path.join(__dirname, "sprint-config.json");

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const UY = -3 * HORA; // hora de Uruguay (sin horario de verano)

// Metas del Anexo 9 §10.2.
export const METAS = {
  releasesPorSprint: 1,
  leadTimeMedianaDias: 14, // ≤ 1 sprint
  tasaFallas: 0.15, // < 15 %
  recuperacionHoras: 24, // < 1 día hábil (aproximado a 24 h)
  pipelineMinutos: 10, // hasta staging
};

const TAG_RELEASE = /^v(\d+)\.(\d+)\.(\d+)$/;
const TAG_ENSAYO = /^v\d+\.\d+\.\d+-rc\.\d+$/;
const MERGE_PR = /^Merge pull request #(\d+) from /;

// ---------------------------------------------------------------------------
// Clasificación de los deployments
// ---------------------------------------------------------------------------

/** Qué fue un deploy a production según su ref. */
export function tipoDeploy(ref) {
  if (TAG_RELEASE.test(ref)) return "release";
  if (TAG_ENSAYO.test(ref)) return "ensayo";
  return "rollback";
}

/** true si el tag es un parche (vX.Y.Z con Z > 0): un hotfix. */
export function esHotfix(tag) {
  const m = TAG_RELEASE.exec(tag);
  return Boolean(m) && Number(m[3]) > 0;
}

/**
 * Resultado de un deployment a partir de sus estados. GitHub agrega estados
 * en orden (waiting, queued, in_progress, success o failure) y después marca
 * "inactive" los que quedan reemplazados: un "success" en la lista alcanza.
 */
export function resultadoDeploy(estados) {
  const exitos = estados
    .filter((e) => e.state === "success")
    .map((e) => new Date(e.created_at))
    .sort((a, b) => a - b);
  if (exitos.length > 0) return { estado: "exitoso", fin: exitos[0] };
  const fallas = estados
    .filter((e) => e.state === "failure" || e.state === "error")
    .map((e) => new Date(e.created_at))
    .sort((a, b) => a - b);
  if (fallas.length > 0) return { estado: "fallido", fin: fallas[0] };
  return { estado: "incompleto", fin: null }; // rechazado, cancelado o en curso
}

/**
 * Releases, fallas y recuperación a partir de los deployments de production
 * ya resueltos: [{ ref, sha, creado: Date, estado, fin: Date|null }].
 */
export function analizarProduccion(deploys) {
  const ordenados = [...deploys].sort((a, b) => a.creado - b.creado);
  const exitosos = ordenados.filter((d) => d.estado === "exitoso");

  // Un mismo tag se puede volver a desplegar (re-run): cuenta el primero.
  const vistos = new Set();
  const releases = [];
  for (const d of exitosos) {
    if (tipoDeploy(d.ref) !== "release" || vistos.has(d.ref)) continue;
    vistos.add(d.ref);
    releases.push({ tag: d.ref, sha: d.sha, desplegado: d.fin });
  }
  const rollbacks = exitosos.filter((d) => tipoDeploy(d.ref) === "rollback");

  for (const [i, r] of releases.entries()) {
    const siguiente = releases[i + 1];
    const hasta = siguiente ? siguiente.desplegado : new Date(8.64e15);
    const rollback = rollbacks.find(
      (d) => d.fin > r.desplegado && d.fin < hasta,
    );
    const hotfix = siguiente && esHotfix(siguiente.tag) ? siguiente : null;
    const recuperado = [rollback?.fin, hotfix?.desplegado]
      .filter(Boolean)
      .sort((a, b) => a - b)[0];
    r.falla = Boolean(rollback || hotfix);
    r.motivo = rollback
      ? `rollback a ${rollback.ref === "main" ? "un tag anterior" : rollback.ref}`
      : hotfix
        ? `hotfix ${hotfix.tag}`
        : "";
    r.recuperacionHoras = recuperado
      ? (recuperado - r.desplegado) / HORA
      : null;
  }

  return {
    releases,
    ensayos: exitosos.filter((d) => tipoDeploy(d.ref) === "ensayo"),
    rollbacks,
    deploysFallidos: ordenados.filter((d) => d.estado === "fallido"),
  };
}

// ---------------------------------------------------------------------------
// Estadística
// ---------------------------------------------------------------------------

/** Percentil con interpolación lineal (p entre 0 y 1). null si no hay datos. */
export function percentil(valores, p) {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const pos = (v.length - 1) * p;
  const base = Math.floor(pos);
  const resto = pos - base;
  return v[base + 1] === undefined
    ? v[base]
    : v[base] + resto * (v[base + 1] - v[base]);
}

/**
 * Lead time de los PR de un release. prs: [{ numero, creado, mergeado,
 * primerCommit }] (Date). Devuelve horas por PR.
 */
export function leadTimePrs(prs, desplegado) {
  return prs.map((pr) => ({
    numero: pr.numero,
    total: (desplegado - pr.primerCommit) / HORA,
    revision: (pr.mergeado - pr.creado) / HORA,
    release: (desplegado - pr.mergeado) / HORA,
  }));
}

/** PR mergeados que aparecen en los mensajes de una lista de commits. */
export function prsDeCommits(commits) {
  const numeros = new Set();
  for (const c of commits) {
    const m = MERGE_PR.exec(c.commit?.message ?? "");
    if (m) numeros.add(Number(m[1]));
  }
  return [...numeros].sort((a, b) => a - b);
}

/** true si el PR es un cambio (entra a develop desde una rama de trabajo). */
export function esPrDeCambio(pr) {
  return (
    Boolean(pr.merged_at) &&
    pr.base?.ref === "develop" &&
    pr.head?.ref !== "main"
  );
}

// ---------------------------------------------------------------------------
// Fechas y sprints
// ---------------------------------------------------------------------------

/** Fecha en hora de Uruguay como "AAAA-MM-DD". */
export function diaUy(fecha) {
  return new Date(fecha.getTime() + UY).toISOString().slice(0, 10);
}

export function fechaCorta(fecha) {
  const [, m, d] = diaUy(fecha).split("-");
  return `${d}/${m}`;
}

/**
 * Sprint de una fecha: de su inicio al día anterior al inicio del siguiente
 * (lo del fin de semana cuenta para el sprint que terminó). Después del
 * último, "Después de la entrega".
 */
export function sprintDe(fecha, sprints) {
  const dia = diaUy(fecha);
  for (const [i, s] of sprints.entries()) {
    const siguiente = sprints[i + 1];
    if (dia >= s.inicio && (!siguiente || dia < siguiente.inicio)) {
      if (!siguiente && dia > s.fin) return "Después de la entrega";
      return s.nombre;
    }
  }
  return "Antes del proyecto";
}

/** Releases por sprint, desde el sprint del primer release hasta hoy. */
export function frecuenciaPorSprint(releases, sprints, hoy) {
  if (releases.length === 0) return [];
  const primero = sprintDe(releases[0].desplegado, sprints);
  const actual = sprintDe(hoy, sprints);
  const nombres = sprints.map((s) => s.nombre);
  const desde = Math.max(0, nombres.indexOf(primero));
  const hastaIdx = nombres.indexOf(actual);
  const hasta = hastaIdx === -1 ? nombres.length - 1 : hastaIdx;
  return nombres.slice(desde, hasta + 1).map((nombre) => ({
    sprint: nombre,
    releases: releases.filter((r) => sprintDe(r.desplegado, sprints) === nombre)
      .length,
  }));
}

/** Lunes (hora de Uruguay) de la semana de una fecha, como "AAAA-MM-DD". */
export function semanaDe(fecha) {
  const local = new Date(fecha.getTime() + UY);
  const dow = (local.getUTCDay() + 6) % 7; // 0 = lunes
  return new Date(local.getTime() - dow * DIA).toISOString().slice(0, 10);
}

/** Cantidad por semana en las últimas `semanas` semanas (incluida la actual). */
export function porSemana(fechas, hoy, semanas) {
  const actual = new Date(`${semanaDe(hoy)}T00:00:00Z`);
  const bins = [];
  for (let i = semanas - 1; i >= 0; i--) {
    const lunes = new Date(actual.getTime() - i * 7 * DIA);
    bins.push({ semana: lunes.toISOString().slice(0, 10), cantidad: 0 });
  }
  for (const f of fechas) {
    const bin = bins.find((b) => b.semana === semanaDe(f));
    if (bin) bin.cantidad += 1;
  }
  return bins;
}

// ---------------------------------------------------------------------------
// Resumen y semáforo
// ---------------------------------------------------------------------------

export function resumenDora({ releases, frecuencia, leadTimes }) {
  const conLead = leadTimes.flatMap((l) => l.prs.map((p) => p.total));
  const fallidos = releases.filter((r) => r.falla);
  const recuperaciones = fallidos
    .map((r) => r.recuperacionHoras)
    .filter((h) => h !== null);
  const sprintsCerrados = frecuencia.slice(0, -1); // el actual sigue abierto
  return {
    releases: releases.length,
    releasesPorSprint:
      sprintsCerrados.length > 0
        ? sprintsCerrados.reduce((a, s) => a + s.releases, 0) /
          sprintsCerrados.length
        : null,
    leadTimeMedianaDias: conLead.length ? percentil(conLead, 0.5) / 24 : null,
    leadTimeP85Dias: conLead.length ? percentil(conLead, 0.85) / 24 : null,
    prsMedidos: conLead.length,
    fallidos: fallidos.length,
    tasaFallas: releases.length ? fallidos.length / releases.length : null,
    recuperacionMedianaHoras: recuperaciones.length
      ? percentil(recuperaciones, 0.5)
      : null,
  };
}

/** 🟢 cumple, 🔴 no cumple, ⚪ sin datos. */
export function semaforo(valor, meta, sentido) {
  if (valor === null || valor === undefined) return "⚪";
  const cumple = sentido === "min" ? valor >= meta : valor <= meta;
  return cumple ? "🟢" : "🔴";
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function num(n, decimales = 1) {
  return n === null || n === undefined
    ? "—"
    : n.toLocaleString("es-UY", {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimales,
      });
}

function duracion(horas) {
  if (horas === null || horas === undefined) return "—";
  return horas < 48 ? `${num(horas)} h` : `${num(horas / 24)} días`;
}

export function renderResumen(r, fecha) {
  const pct = r.tasaFallas === null ? "—" : `${num(r.tasaFallas * 100, 0)} %`;
  return `| Métrica | Valor | Meta | Estado |
| --- | --- | --- | --- |
| Frecuencia de despliegue | ${r.releases} release${r.releases === 1 ? "" : "s"} · ${num(r.releasesPorSprint)} por sprint cerrado | ≥ ${METAS.releasesPorSprint} por sprint | ${semaforo(r.releasesPorSprint, METAS.releasesPorSprint, "min")} |
| Lead time de cambios | Mediana ${num(r.leadTimeMedianaDias)} días · p85 ${num(r.leadTimeP85Dias)} días (${r.prsMedidos} PR) | Mediana ≤ ${METAS.leadTimeMedianaDias} días | ${semaforo(r.leadTimeMedianaDias, METAS.leadTimeMedianaDias, "max")} |
| Tasa de fallas en cambios | ${pct} (${r.fallidos} de ${r.releases}) | < ${num(METAS.tasaFallas * 100, 0)} % | ${semaforo(r.tasaFallas, METAS.tasaFallas - 1e-9, "max")} |
| Tiempo de recuperación | ${r.fallidos === 0 ? "Sin fallas" : `Mediana ${duracion(r.recuperacionMedianaHoras)}`} | < ${METAS.recuperacionHoras} h | ${r.fallidos === 0 ? "⚪" : semaforo(r.recuperacionMedianaHoras, METAS.recuperacionHoras, "max")} |

> Actualizado el ${fecha} desde GitHub (deployments del environment \`production\`). 🟢 cumple la meta · 🔴 no la cumple · ⚪ sin datos suficientes.`;
}

export function renderReleases(analisis, leadTimes) {
  const filas = analisis.releases.map((r) => {
    const lt = leadTimes.find((l) => l.tag === r.tag);
    const lead =
      !lt
        ? "—"
        : lt.primero
          ? "Línea base (primer release)"
          : lt.prs.length === 0
            ? "Sin PR"
            : `${duracion(percentil(lt.prs.map((p) => p.total), 0.5))} (${lt.prs.length} PR)`;
    const resultado = r.falla
      ? `🔴 ${r.motivo} · recuperado en ${duracion(r.recuperacionHoras)}`
      : "🟢 Sin rollback ni hotfix";
    return `| \`${r.tag}\` | ${fechaCorta(r.desplegado)} | \`${r.sha.slice(0, 7)}\` | ${lead} | ${resultado} |`;
  });
  const otros = [
    ...analisis.ensayos.map(
      (d) =>
        `| \`${d.ref}\` (ensayo) | ${fechaCorta(d.fin)} | \`${d.sha.slice(0, 7)}\` | — | No cuenta para DORA |`,
    ),
    ...analisis.deploysFallidos.map(
      (d) =>
        `| \`${d.ref}\` (deploy fallido) | ${fechaCorta(d.creado)} | \`${d.sha.slice(0, 7)}\` | — | Producción siguió con la versión anterior |`,
    ),
  ];
  if (filas.length === 0 && otros.length === 0) {
    return "_Todavía no hay deploys a producción._";
  }
  return `| Versión | Fecha | Commit | Lead time (mediana) | Resultado |
| --- | --- | --- | --- | --- |
${[...filas, ...otros].join("\n")}`;
}

export function renderFrecuencia(frecuencia) {
  if (frecuencia.length === 0) return "_Todavía no hay releases._";
  const max = Math.max(2, ...frecuencia.map((f) => f.releases));
  return `\`\`\`mermaid
xychart-beta
    title "Releases a producción por sprint"
    x-axis [${frecuencia.map((f) => `"${f.sprint}"`).join(", ")}]
    y-axis "Releases" 0 --> ${max}
    bar [${frecuencia.map((f) => f.releases).join(", ")}]
\`\`\``;
}

export function renderLeadTime(leadTimes) {
  const medidos = leadTimes.filter((l) => !l.primero && l.prs.length > 0);
  if (medidos.length === 0) {
    return "_Se mide desde el segundo release: el primero incluye todo el historial del proyecto y no es comparable._";
  }
  return `| Release | PR | Lead time (mediana · p85) | Revisión (mediana) | Release (mediana) |
| --- | --- | --- | --- | --- |
${medidos
  .map((l) => {
    const t = l.prs.map((p) => p.total);
    const rev = l.prs.map((p) => p.revision);
    const rel = l.prs.map((p) => p.release);
    return `| \`${l.tag}\` | ${l.prs.length} | ${duracion(percentil(t, 0.5))} · ${duracion(percentil(t, 0.85))} | ${duracion(percentil(rev, 0.5))} | ${duracion(percentil(rel, 0.5))} |`;
  })
  .join("\n")}

> **Revisión:** desde que se abre el PR hasta el merge a \`develop\`. **Release:** desde el merge hasta el deploy en producción. El lead time completo empieza en el primer commit del PR.`;
}

export function renderContexto(c) {
  const semanas = c.stagingPorSemana;
  return `| Métrica de contexto | Valor | Meta |
| --- | --- | --- |
| Deploys a staging (últimas ${semanas.length} semanas) | Exitosos: ${semanas.reduce((a, s) => a + s.cantidad, 0)} · fallidos: ${c.stagingFallidos} | ≥ 3 por semana |
| Duración del pipeline hasta staging (mediana) | ${c.pipelineMedianaMin === null ? "—" : `${num(c.pipelineMedianaMin)} min (corridas medidas: ${c.pipelineCorridas})`} | < ${METAS.pipelineMinutos} min |
| Rollbacks de producción | ${c.rollbacksProduccion} | — |
| Incidentes registrados (etiqueta \`incidente\`) | ${c.incidentesAbiertos} abiertos · ${c.incidentesCerrados} cerrados | — |

\`\`\`mermaid
xychart-beta
    title "Deploys exitosos a staging por semana"
    x-axis [${semanas.map((s) => `"${s.semana.slice(8, 10)}/${s.semana.slice(5, 7)}"`).join(", ")}]
    y-axis "Deploys" 0 --> ${Math.max(3, ...semanas.map((s) => s.cantidad))}
    bar [${semanas.map((s) => s.cantidad).join(", ")}]
\`\`\``;
}

export function reemplazarBloque(contenido, marcador, interior) {
  const inicio = `<!-- AUTO:${marcador}:start -->`;
  const fin = `<!-- AUTO:${marcador}:end -->`;
  const a = contenido.indexOf(inicio);
  const b = contenido.indexOf(fin);
  if (a === -1 || b === -1 || b < a) {
    throw new Error(`No está el bloque AUTO:${marcador} en la plantilla`);
  }
  return `${contenido.slice(0, a + inicio.length)}\n\n${interior}\n\n${contenido.slice(b)}`;
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

function cliente(token, repo) {
  const base = `https://api.github.com/repos/${repo}`;
  async function pedir(url) {
    const res = await fetch(url.startsWith("http") ? url : `${base}${url}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub respondió ${res.status} en ${url}`);
    }
    return res;
  }
  return {
    async uno(url) {
      return (await pedir(url)).json();
    },
    /** Todas las páginas (Link: rel="next"), hasta `maximo` elementos. */
    async todos(url, { clave, maximo = 1000 } = {}) {
      const items = [];
      let siguiente = url;
      while (siguiente && items.length < maximo) {
        const res = await pedir(siguiente);
        const json = await res.json();
        items.push(...(clave ? json[clave] : json));
        const link = res.headers.get("link") ?? "";
        siguiente = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1] ?? null;
      }
      return items.slice(0, maximo);
    },
  };
}

async function deploysDe(gh, environment) {
  const lista = await gh.todos(
    `/deployments?environment=${environment}&per_page=100`,
  );
  const resultado = [];
  for (const d of lista) {
    const creado = new Date(d.created_at);
    const estados = await gh.todos(`/deployments/${d.id}/statuses?per_page=100`);
    resultado.push({ ref: d.ref, sha: d.sha, creado, ...resultadoDeploy(estados) });
  }
  return resultado;
}

async function prsDeRelease(gh, anterior, tag) {
  const commits = await gh.todos(
    `/compare/${encodeURIComponent(anterior)}...${encodeURIComponent(tag)}?per_page=100`,
    { clave: "commits", maximo: 2000 },
  );
  const prs = [];
  for (const numero of prsDeCommits(commits)) {
    const pr = await gh.uno(`/pulls/${numero}`);
    if (!esPrDeCambio(pr)) continue;
    const suyos = await gh.todos(`/pulls/${numero}/commits?per_page=100`, {
      maximo: 250,
    });
    const fechas = suyos
      .map((c) => new Date(c.commit.author.date))
      .sort((a, b) => a - b);
    prs.push({
      numero,
      creado: new Date(pr.created_at),
      mergeado: new Date(pr.merged_at),
      primerCommit: fechas[0] ?? new Date(pr.created_at),
    });
  }
  return prs;
}

/**
 * Deploys a staging de las corridas del CI en develop desde `desde`: un
 * pedido por corrida (sus jobs). Se usa para la frecuencia de staging y la
 * duración del pipeline, sin leer los estados de cada deployment de staging.
 */
async function deploysStaging(gh, desde, maximo) {
  const runs = await gh.todos(
    `/actions/workflows/ci.yml/runs?branch=develop&status=completed&created=%3E%3D${diaUy(desde)}&per_page=100`,
    { clave: "workflow_runs", maximo },
  );
  const deploys = [];
  for (const run of runs) {
    const jobs = await gh.todos(`/actions/runs/${run.id}/jobs?per_page=100`, {
      clave: "jobs",
    });
    const job = jobs.find((j) => /Deploy staging/.test(j.name));
    if (!job || !["success", "failure"].includes(job.conclusion)) continue;
    const fin = new Date(job.completed_at);
    deploys.push({
      exitoso: job.conclusion === "success",
      fin,
      minutos: (fin - new Date(run.run_started_at)) / 60000,
    });
  }
  return deploys;
}

async function incidentes(gh, repo) {
  const q = encodeURIComponent(`repo:${repo} is:issue label:incidente`);
  const json = await gh.uno(
    `https://api.github.com/search/issues?q=${q}&per_page=100`,
  );
  const abiertos = json.items.filter((i) => i.state === "open").length;
  return { abiertos, cerrados: json.items.length - abiertos };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    throw new Error("Faltan GITHUB_TOKEN o GITHUB_REPOSITORY en el entorno.");
  }
  const gh = cliente(token, repo);
  const hoy = new Date();
  const { sprints } = JSON.parse(await fs.readFile(SPRINTS, "utf-8"));

  const produccion = analizarProduccion(await deploysDe(gh, "production"));

  const leadTimes = [];
  for (const [i, r] of produccion.releases.entries()) {
    if (i === 0) {
      leadTimes.push({ tag: r.tag, primero: true, prs: [] });
      continue;
    }
    const prs = await prsDeRelease(gh, produccion.releases[i - 1].tag, r.tag);
    leadTimes.push({ tag: r.tag, primero: false, prs: leadTimePrs(prs, r.desplegado) });
  }

  // Contexto de staging: 4 semanas y hasta 60 corridas, para no pasar el
  // límite de pedidos del GITHUB_TOKEN (el workflow también corre con cada
  // evento de issue).
  const semanas = 4;
  const staging = await deploysStaging(
    gh,
    new Date(hoy.getTime() - semanas * 7 * DIA),
    60,
  );
  const exitososStaging = staging.filter((s) => s.exitoso);
  const inc = await incidentes(gh, repo);

  const frecuencia = frecuenciaPorSprint(produccion.releases, sprints, hoy);
  const resumen = resumenDora({
    releases: produccion.releases,
    frecuencia,
    leadTimes,
  });
  const fecha = new Intl.DateTimeFormat("es-UY", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Montevideo",
  }).format(hoy);

  let md = await fs.readFile(DASHBOARD, "utf-8");
  md = reemplazarBloque(md, "dora-resumen", renderResumen(resumen, fecha));
  md = reemplazarBloque(md, "dora-releases", renderReleases(produccion, leadTimes));
  md = reemplazarBloque(md, "dora-frecuencia", renderFrecuencia(frecuencia));
  md = reemplazarBloque(md, "dora-lead-time", renderLeadTime(leadTimes));
  md = reemplazarBloque(
    md,
    "dora-contexto",
    renderContexto({
      stagingPorSemana: porSemana(
        exitososStaging.map((s) => s.fin),
        hoy,
        semanas,
      ),
      stagingFallidos: staging.length - exitososStaging.length,
      pipelineMedianaMin: exitososStaging.length
        ? percentil(exitososStaging.map((s) => s.minutos), 0.5)
        : null,
      pipelineCorridas: exitososStaging.length,
      rollbacksProduccion: produccion.rollbacks.length,
      incidentesAbiertos: inc.abiertos,
      incidentesCerrados: inc.cerrados,
    }),
  );
  await fs.writeFile(DASHBOARD, md, "utf-8");
  console.log(
    `✅ Calidad del proceso: ${resumen.releases} releases, ${resumen.prsMedidos} PR con lead time.`,
  );
}

// Solo corre main() si se ejecuta directo (no al importarlo desde un test).
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    console.error("❌ Error calculando las métricas DORA:", err.message);
    process.exit(1);
  });
}
