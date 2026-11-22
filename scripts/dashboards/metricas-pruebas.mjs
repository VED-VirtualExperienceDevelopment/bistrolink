// scripts/dashboards/metricas-pruebas.mjs
//
// BL-601: sección «Plan de pruebas» del dashboard «Calidad del proceso»
// (docs/dashboard-calidad-proceso.md). Llena los bloques AUTO pruebas-kiwi y
// pruebas-cobertura en la copia del runner; no se commitea nada.
//
// Fuentes:
//   - Kiwi TCMS: el JSON que deja datos-kiwi.py (casos y últimos Test Runs de
//     cada Test Plan activo). Ruta en KIWI_DATOS.
//   - Codecov: API pública del repositorio (cobertura total y por flag).
//
// Si falta una fuente, su bloque dice que no hubo datos en esta publicación.
//
// Uso local:
//   KIWI_DATOS=kiwi.json node scripts/dashboards/metricas-pruebas.mjs
//   git restore docs/dashboard-calidad-proceso.md

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reemplazarBloque } from "./metricas-dora.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DASHBOARD = path.join(ROOT, "docs", "dashboard-calidad-proceso.md");
const CODECOV =
  "https://api.codecov.io/api/v2/github/VED-VirtualExperienceDevelopment/repos/bistrolink";

export const META_COBERTURA = 80; // Anexo 9: ≥ 80 % en la lógica de negocio
const MAX_NUNCA = 10;

const SIN_DATOS =
  "_Sin datos en esta publicación: se completa en la próxima corrida del workflow «Publicar dashboards»._";

// ---------------------------------------------------------------------------
// Kiwi TCMS
// ---------------------------------------------------------------------------

/** Aprobados, fallidos y sin ejecutar de un Test Run (por el peso del estado). */
export function conteoRun(run) {
  const c = { aprobados: 0, fallidos: 0, sinEjecutar: 0 };
  for (const e of run.ejecuciones) {
    if (e.peso > 0) c.aprobados += 1;
    else if (e.peso < 0) c.fallidos += 1;
    else c.sinEjecutar += 1;
  }
  const ejecutados = c.aprobados + c.fallidos;
  c.ejecutados = ejecutados;
  c.aprobacion = ejecutados ? c.aprobados / ejecutados : null;
  return c;
}

/**
 * Resumen de un Test Plan. Los runs vienen del más nuevo al más viejo.
 * «Nunca ejecutados»: casos sin ninguna ejecución terminada (aprobada o
 * fallida) en los Test Runs que conserva Kiwi.
 */
export function resumenPlan(plan) {
  const runs = plan.runs.map((r) => ({ ...r, ...conteoRun(r) }));
  const ejecutadosAlgunaVez = new Set(
    plan.runs.flatMap((r) => r.ejecuciones.filter((e) => e.peso !== 0).map((e) => e.caso)),
  );
  const nunca = plan.casos.filter((c) => !ejecutadosAlgunaVez.has(c.id));
  return {
    id: plan.id,
    nombre: plan.nombre,
    casos: plan.casos.length,
    runsTotales: plan.runsTotales,
    ultimo: runs[0] ?? null,
    tendencia: runs
      .slice(0, 5)
      .reverse()
      .map((r) => r.aprobacion),
    nunca,
  };
}

function pct(valor) {
  return valor === null || valor === undefined ? "—" : `${Math.round(valor * 100)} %`;
}

/** "2026-11-21 22:10:05" → "21/11". */
export function fechaKiwi(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto ?? "");
  return m ? `${m[3]}/${m[2]}` : "—";
}

export function renderKiwi(datos) {
  const planes = datos.planes
    .map(resumenPlan)
    .filter((p) => p.casos > 0 || p.runsTotales > 0);
  if (planes.length === 0) return "_Kiwi TCMS no tiene Test Plans activos con casos._";

  const filas = planes.map((p) => {
    const u = p.ultimo;
    const ultimo = u
      ? `${fechaKiwi(u.inicio)} · ${u.ejecutados} de ${u.ejecuciones.length} ejecutados`
      : "Sin Test Runs";
    const estado =
      !u || u.aprobacion === null ? "⚪" : u.fallidos > 0 ? "🔴" : "🟢";
    return `| TP-${p.id} ${p.nombre} | ${p.casos} | ${ultimo} | ${pct(u?.aprobacion)} | ${p.tendencia.map(pct).join(" → ") || "—"} | ${p.nunca.length} | ${estado} |`;
  });

  const totalCasos = planes.reduce((a, p) => a + p.casos, 0);
  const totalNunca = planes.reduce((a, p) => a + p.nunca.length, 0);

  const detalles = planes
    .filter((p) => p.nunca.length > 0)
    .map(
      (p) =>
        `**TP-${p.id} ${p.nombre}** (${p.nunca.length}):\n\n${p.nunca
          .slice(0, MAX_NUNCA)
          .map((c) => `- ${String(c.titulo).replace(/\s*[\r\n|]+\s*/g, " ")}`)
          .join("\n")}${p.nunca.length > MAX_NUNCA ? `\n- … y ${p.nunca.length - MAX_NUNCA} más (ver el plan en Kiwi)` : ""}`,
    );

  return `| Test Plan | Casos | Último Test Run | Aprobación | Tendencia (últimos 5 runs) | Nunca ejecutados | Estado |
| --- | --- | --- | --- | --- | --- | --- |
${filas.join("\n")}

> **Casos: ${totalCasos}** (Test Plans: ${planes.length}) · **sin ninguna ejecución: ${totalNunca}**, en los Test Runs que conserva Kiwi. Aprobación = aprobados sobre ejecutados (los casos sin ejecutar no cuentan). 🟢 el último run no tiene fallos · 🔴 tiene fallos · ⚪ sin ejecuciones.

${detalles.length ? `#### Casos que nunca se ejecutaron\n\n${detalles.join("\n\n")}` : "Todos los casos tienen al menos una ejecución. ✅"}`;
}

// ---------------------------------------------------------------------------
// Codecov
// ---------------------------------------------------------------------------

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** Cobertura total y por flag a partir de las respuestas de la API. */
export function datosCodecov(repo, flags) {
  return {
    total: numero(repo?.totals?.coverage),
    rama: repo?.branch ?? null,
    flags: (flags?.results ?? [])
      .map((f) => ({ nombre: f.flag_name ?? f.name, cobertura: numero(f.coverage) }))
      .filter((f) => f.nombre),
  };
}

export function renderCobertura(c) {
  if (c.total === null && c.flags.length === 0) return SIN_DATOS;
  // La meta se mide sobre el backend; el resto es informativo.
  const fila = (nombre, valor, conMeta) =>
    `| ${nombre} | ${valor === null ? "—" : `${valor.toFixed(1).replace(".", ",")} %`} | ${!conMeta ? "—" : valor === null ? "⚪" : valor >= META_COBERTURA ? "🟢" : "🔴"} |`;
  return `| Cobertura (Codecov${c.rama ? `, rama \`${c.rama}\`` : ""}) | Valor | Estado |
| --- | --- | --- |
${[fila("**Total**", c.total, false), ...c.flags.map((f) => fila(f.nombre, f.cobertura, f.nombre === "backend"))].join("\n")}

> Meta del Anexo 9: ≥ ${META_COBERTURA} % en la lógica de negocio, que está en el backend: el semáforo se aplica solo a esa fila. El total mezcla backend y frontend, y el frontend recién empezó a tener tests (BL-160). Detalle por archivo en [Codecov](https://app.codecov.io/gh/VED-VirtualExperienceDevelopment/bistrolink).`;
}

async function leerCodecov() {
  const pedir = async (url) => {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Codecov respondió ${res.status}`);
    return res.json();
  };
  const repo = await pedir(`${CODECOV}/`);
  let flags = null;
  try {
    flags = await pedir(`${CODECOV}/flags/`);
  } catch {
    // Sin flags, se muestra solo el total.
  }
  return datosCodecov(repo, flags);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let md = await fs.readFile(DASHBOARD, "utf-8");

  let kiwi = SIN_DATOS;
  if (process.env.KIWI_DATOS) {
    try {
      kiwi = renderKiwi(JSON.parse(await fs.readFile(process.env.KIWI_DATOS, "utf-8")));
    } catch (err) {
      console.error(`⚠️ Kiwi TCMS: ${err.message}`);
    }
  } else {
    console.error("⚠️ Sin KIWI_DATOS: la sección de Kiwi queda sin datos.");
  }

  let cobertura = SIN_DATOS;
  try {
    cobertura = renderCobertura(await leerCodecov());
  } catch (err) {
    console.error(`⚠️ Codecov: ${err.message}`);
  }

  md = reemplazarBloque(md, "pruebas-kiwi", kiwi);
  md = reemplazarBloque(md, "pruebas-cobertura", cobertura);
  await fs.writeFile(DASHBOARD, md, "utf-8");
  console.log("✅ Sección del plan de pruebas actualizada.");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    console.error("❌ Error en la sección del plan de pruebas:", err.message);
    process.exit(1);
  });
}
