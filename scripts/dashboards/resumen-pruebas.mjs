#!/usr/bin/env node
// BL-601: resumen de una corrida de pruebas en el Summary de GitHub Actions.
//
// Lee uno o más junit.xml (Jest, contratos, integración, E2E, performance) y
// escribe en $GITHUB_STEP_SUMMARY una tabla con aprobados, fallidos,
// salteados y duración, la lista de tests que fallaron (solo el nombre: el
// repositorio es público y los mensajes de error pueden traer datos de la
// sesión de prueba) y dónde ver el detalle.
//
// Uso:
//   node scripts/dashboards/resumen-pruebas.mjs --titulo "🧪 Tests unitarios" \
//     [--kiwi "Integration tests"] [--artifact coverage-report-backend] \
//     "Backend=apps/backend/coverage/junit.xml" "Frontend=apps/frontend/coverage/junit.xml"
//
// Un archivo que no existe (por ejemplo, porque el paso anterior se cortó)
// aparece como «sin resultados», sin hacer fallar el paso.
// Variables: GITHUB_STEP_SUMMARY, GITHUB_SERVER_URL, GITHUB_REPOSITORY y
// GITHUB_RUN_ID (las pone Actions). Sin GITHUB_STEP_SUMMARY, escribe en la
// salida estándar.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodificar(texto) {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (todo, e) => {
    if (e[0] === "#") {
      const codigo =
        e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
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
 * Totales de un junit.xml, contando cada <testcase>: falla si tiene
 * <failure> o <error>, salteado si tiene <skipped>, si no pasa. La duración
 * es la del <testsuites> raíz o, si no la tiene, la suma de las <testsuite>.
 */
export function totalesJunit(xml) {
  const t = { total: 0, pasan: 0, fallan: 0, salteados: 0, segundos: 0, fallidos: [] };
  for (const caso of xml.matchAll(
    /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g,
  )) {
    const attrs = atributos(caso[1]);
    const cuerpo = caso[2] ?? "";
    t.total += 1;
    if (/<(failure|error)\b/.test(cuerpo)) {
      t.fallan += 1;
      t.fallidos.push(attrs.name ?? "(sin nombre)");
    } else if (/<skipped\b/.test(cuerpo)) {
      t.salteados += 1;
    } else {
      t.pasan += 1;
    }
  }
  const raiz = /<testsuites\b([^>]*)>/.exec(xml);
  const tiempoRaiz = raiz ? Number(atributos(raiz[1]).time) : NaN;
  if (Number.isFinite(tiempoRaiz) && tiempoRaiz > 0) {
    t.segundos = tiempoRaiz;
  } else {
    for (const s of xml.matchAll(/<testsuite\b([^>]*)>/g)) {
      const tiempo = Number(atributos(s[1]).time);
      if (Number.isFinite(tiempo)) t.segundos += tiempo;
    }
  }
  return t;
}

export function duracion(segundos) {
  if (!segundos) return "—";
  if (segundos < 60) return `${Math.round(segundos)} s`;
  const min = Math.floor(segundos / 60);
  const seg = Math.round(segundos % 60);
  return seg ? `${min} min ${seg} s` : `${min} min`;
}

/** "Etiqueta=ruta" → { etiqueta, ruta }. Sin "=", la etiqueta es el archivo. */
export function parsearEntrada(entrada) {
  const i = entrada.indexOf("=");
  if (i === -1) return { etiqueta: path.basename(entrada), ruta: entrada };
  return { etiqueta: entrada.slice(0, i), ruta: entrada.slice(i + 1) };
}

const MAX_FALLIDOS = 20;

/**
 * Markdown del resumen. grupos: [{ etiqueta, totales | null }].
 * enlaces: { corrida, artifact, kiwi } (opcionales).
 */
export function renderResumen(titulo, grupos, enlaces = {}) {
  const filas = grupos.map(({ etiqueta, totales: t }) =>
    t === null
      ? `| ${etiqueta} | — | — | — | — | — | Sin resultados (el paso no llegó a generarlos) |`
      : `| ${etiqueta} | ${t.total} | ${t.pasan} | ${t.fallan} | ${t.salteados} | ${duracion(t.segundos)} | ${t.fallan > 0 ? "❌" : t.total === 0 ? "⚪ Sin tests" : "✅"} |`,
  );
  const conDatos = grupos.filter((g) => g.totales !== null).map((g) => g.totales);
  if (conDatos.length > 1) {
    const suma = (k) => conDatos.reduce((a, t) => a + t[k], 0);
    filas.push(
      `| **Total** | **${suma("total")}** | **${suma("pasan")}** | **${suma("fallan")}** | **${suma("salteados")}** | **${duracion(suma("segundos"))}** | ${suma("fallan") > 0 ? "❌" : "✅"} |`,
    );
  }

  const fallidos = grupos.flatMap(({ etiqueta, totales }) =>
    (totales?.fallidos ?? []).map((n) => `${etiqueta} › ${n}`),
  );
  const listaFallidos =
    fallidos.length === 0
      ? ""
      : `\n**Tests que fallaron** (solo el nombre; el detalle está en el artifact${enlaces.kiwi ? " y en Kiwi TCMS" : ""}):\n\n${fallidos
          .slice(0, MAX_FALLIDOS)
          .map((n) => `- ${n.replace(/[\r\n|]+/g, " ")}`)
          .join("\n")}${fallidos.length > MAX_FALLIDOS ? `\n- … y ${fallidos.length - MAX_FALLIDOS} más` : ""}\n`;

  const detalle = [
    enlaces.artifact
      ? `artifact \`${enlaces.artifact}\`${enlaces.corrida ? ` ([corrida](${enlaces.corrida}))` : ""}`
      : null,
    enlaces.kiwi ? `Test Plan «${enlaces.kiwi}» en Kiwi TCMS` : null,
    enlaces.allure ? `[reporte Allure](${enlaces.allure})` : null,
  ].filter(Boolean);

  return `### ${titulo}

| Suite | Tests | ✅ Pasan | ❌ Fallan | ⏭️ Salteados | Duración | Estado |
| --- | --- | --- | --- | --- | --- | --- |
${filas.join("\n")}
${listaFallidos}${detalle.length ? `\nDetalle: ${detalle.join(" · ")}.\n` : ""}`;
}

export function parsearArgumentos(argv) {
  const opciones = { titulo: "Resultados de las pruebas", entradas: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--titulo") opciones.titulo = argv[++i];
    else if (a === "--kiwi") opciones.kiwi = argv[++i];
    else if (a === "--artifact") opciones.artifact = argv[++i];
    else if (a === "--allure") opciones.allure = argv[++i];
    else opciones.entradas.push(parsearEntrada(a));
  }
  return opciones;
}

async function main() {
  const op = parsearArgumentos(process.argv.slice(2));
  const grupos = [];
  for (const { etiqueta, ruta } of op.entradas) {
    let xml;
    try {
      xml = await fs.readFile(ruta, "utf-8");
    } catch {
      grupos.push({ etiqueta, totales: null });
      continue;
    }
    grupos.push({ etiqueta, totales: totalesJunit(xml) });
  }
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  const corrida =
    GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
      ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
      : undefined;
  const md = renderResumen(op.titulo, grupos, {
    corrida,
    artifact: op.artifact,
    kiwi: op.kiwi,
    allure: op.allure,
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  } else {
    console.log(md);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    // El resumen es informativo: nunca hace fallar el job.
    console.error("⚠️ No se pudo armar el resumen de las pruebas:", err.message);
  });
}
