#!/usr/bin/env node
// BL-597: completa los resultados de Allure de los E2E antes de generar el
// reporte, para que no salgan secciones vacías:
//   - environment.properties: entorno, URLs públicas de staging, navegadores,
//     versión, commit, rama y corrida («Ambiente» en el reporte).
//   - executor.json: la corrida de GitHub Actions que generó el reporte
//     («Ejecutor» y el enlace a la corrida).
//   - categories.json: agrupa los fallos por causa probable («Categorías»).
//   - Etiquetas «feature» y «story» en cada resultado, para la pestaña
//     «Comportamientos»: el área sale de la carpeta del spec (admin,
//     comensal, kds…) y la historia, del primer test.describe() o, si no
//     hay, del nombre del archivo.
//
// Corre después de sanitizar-allure.mjs, sobre los resultados ya preparados.
// No agrega datos sensibles: solo URLs públicas y datos de la corrida que ya
// se ven en GitHub Actions. Sin dependencias.
//
// Uso: node scripts/dashboards/datos-allure.mjs <carpeta de resultados>
//
// Variables (todas opcionales; sin ellas, ese dato no aparece):
//   ALLURE_ENTORNO, ALLURE_WEB_URL, ALLURE_API_URL, ALLURE_VERSION,
//   ALLURE_REPORT_NAME, ALLURE_REPORT_URL y las de GitHub Actions
//   (GITHUB_SHA, GITHUB_REF_NAME, GITHUB_RUN_NUMBER, GITHUB_RUN_ID,
//   GITHUB_SERVER_URL, GITHUB_REPOSITORY).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Carpeta del spec (relativa a e2e/) → nombre del área en el reporte.
export const AREAS = {
  admin: "Administración y mozo",
  comensal: "Comensal",
  kds: "Cocina (KDS)",
  plataforma: "Plataforma",
  sesion: "Inicio de sesión",
};
export const AREA_GENERAL = "General";

// Categorías de fallos. Allure asigna la primera que coincide, en este orden.
// Los mensajes ya pasaron por sanitizar-allure.mjs.
export const CATEGORIAS = [
  {
    name: "Inestables (pasaron al reintentar)",
    matchedStatuses: ["passed", "failed", "broken"],
    flaky: true,
  },
  {
    name: "Regresión visual",
    matchedStatuses: ["failed", "broken"],
    messageRegex: "toHaveScreenshot|[Ss]creenshot comparison|pixels? .*differ",
  },
  {
    name: "Inicio de sesión o permisos (401 / 403)",
    matchedStatuses: ["failed", "broken"],
    messageRegex: "\\b(401|403)\\b|Unauthorized|Forbidden",
  },
  {
    name: "Error de la API (5xx)",
    matchedStatuses: ["failed", "broken"],
    messageRegex: "\\b5\\d\\d\\b",
  },
  {
    name: "Tiempo de espera agotado",
    matchedStatuses: ["failed", "broken"],
    messageRegex: "[Tt]imeout \\d+ms exceeded|timed out",
  },
  {
    name: "Fallo de producto (no se cumplió lo esperado)",
    matchedStatuses: ["failed"],
  },
  {
    name: "Fallo del test (error en el código del test)",
    matchedStatuses: ["broken"],
  },
];

const etiqueta = (resultado, nombre) =>
  resultado.labels?.find((l) => l.name === nombre)?.value;

/** «gestion-usuarios.spec.ts» → «Gestion usuarios». */
export function nombreLegible(archivo) {
  const base = path.posix
    .basename(archivo)
    .replace(/\.spec\.[cm]?[jt]sx?$/, "");
  const texto = base.replace(/[-_]+/g, " ").trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Área (feature) e historia (story) de un resultado, a partir del archivo del
 * spec (etiqueta «suite» de allure-playwright, relativa a e2e/) y de los
 * test.describe() (etiqueta «subSuite», separados por « > »).
 */
export function funcionalidad(resultado) {
  const archivo = (etiqueta(resultado, "suite") ?? "").replaceAll("\\", "/");
  const partes = archivo.split("/").filter(Boolean);
  const carpeta = partes.length > 1 ? partes[0] : null;
  const area = carpeta
    ? (AREAS[carpeta] ?? nombreLegible(carpeta))
    : AREA_GENERAL;
  const describe = etiqueta(resultado, "subSuite")?.split(" > ")[0]?.trim();
  const historia = describe || (archivo ? nombreLegible(archivo) : null);
  return { feature: area, story: historia };
}

/** Agrega «feature» y «story» si el resultado no las tiene. Devuelve si cambió. */
export function agregarFuncionalidad(resultado) {
  resultado.labels ??= [];
  const { feature, story } = funcionalidad(resultado);
  let cambio = false;
  if (feature && !etiqueta(resultado, "feature")) {
    resultado.labels.push({ name: "feature", value: feature });
    cambio = true;
  }
  if (story && !etiqueta(resultado, "story")) {
    resultado.labels.push({ name: "story", value: story });
    cambio = true;
  }
  return cambio;
}

// Formato .properties: «\» , «=» , «:» y los espacios de la clave se escapan.
const escaparClave = (t) => t.replace(/[\\=: ]/g, (c) => `\\${c}`);
const escaparValor = (t) =>
  t.replace(/\\/g, "\\\\").replace(/\r?\n/g, " ").replace(/^\s+/, "");

/** Texto de environment.properties con los datos que estén definidos. */
export function propiedadesEntorno(datos) {
  return (
    Object.entries(datos)
      .filter(
        ([, valor]) =>
          valor !== undefined && valor !== null && `${valor}`.trim() !== "",
      )
      .map(
        ([clave, valor]) =>
          `${escaparClave(clave)}=${escaparValor(`${valor}`.trim())}`,
      )
      .join("\n") + "\n"
  );
}

/** Datos del ambiente a partir de las variables y de los navegadores. */
export function datosEntorno(env, navegadores) {
  const sha = env.GITHUB_SHA?.slice(0, 7);
  return {
    Entorno: env.ALLURE_ENTORNO,
    Web: env.ALLURE_WEB_URL,
    API: env.ALLURE_API_URL,
    Navegadores: navegadores.length > 0 ? navegadores.join(", ") : undefined,
    Version: env.ALLURE_VERSION,
    Commit: sha,
    Rama: env.GITHUB_REF_NAME,
    Corrida: env.GITHUB_RUN_NUMBER ? `#${env.GITHUB_RUN_NUMBER}` : undefined,
  };
}

/** executor.json de la corrida de GitHub Actions, o null fuera del CI. */
export function ejecutor(env) {
  const { GITHUB_SERVER_URL: servidor, GITHUB_REPOSITORY: repo } = env;
  if (!servidor || !repo || !env.GITHUB_RUN_ID) return null;
  const numero = Number(env.GITHUB_RUN_NUMBER);
  return {
    name: "GitHub Actions",
    type: "github",
    url: `${servidor}/${repo}/actions`,
    buildOrder: Number.isFinite(numero) ? numero : undefined,
    buildName: `CI/CD BistroLink #${env.GITHUB_RUN_NUMBER ?? env.GITHUB_RUN_ID}`,
    buildUrl: `${servidor}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`,
    reportName: env.ALLURE_REPORT_NAME?.trim() || undefined,
    reportUrl: env.ALLURE_REPORT_URL?.trim() || undefined,
  };
}

/** Escribe los tres archivos y agrega las etiquetas en la carpeta. */
export async function completarCarpeta(carpeta, env = process.env) {
  const archivos = await fs.readdir(carpeta);
  const resultados = archivos.filter((a) => a.endsWith("-result.json"));
  if (resultados.length === 0) {
    throw new Error(`No hay resultados de Allure en ${carpeta}`);
  }

  const navegadores = new Set();
  let etiquetados = 0;
  for (const archivo of resultados) {
    const ruta = path.join(carpeta, archivo);
    const resultado = JSON.parse(await fs.readFile(ruta, "utf-8"));
    const proyecto = etiqueta(resultado, "parentSuite");
    if (proyecto) navegadores.add(proyecto);
    if (agregarFuncionalidad(resultado)) {
      etiquetados += 1;
      await fs.writeFile(ruta, JSON.stringify(resultado), "utf-8");
    }
  }

  const listaNavegadores = [...navegadores].sort();
  await fs.writeFile(
    path.join(carpeta, "environment.properties"),
    propiedadesEntorno(datosEntorno(env, listaNavegadores)),
    "utf-8",
  );
  await fs.writeFile(
    path.join(carpeta, "categories.json"),
    JSON.stringify(CATEGORIAS, null, 2),
    "utf-8",
  );
  const datosEjecutor = ejecutor(env);
  if (datosEjecutor) {
    await fs.writeFile(
      path.join(carpeta, "executor.json"),
      JSON.stringify(datosEjecutor, null, 2),
      "utf-8",
    );
  }

  return {
    resultados: resultados.length,
    etiquetados,
    navegadores: listaNavegadores,
    ejecutor: Boolean(datosEjecutor),
  };
}

async function main() {
  const [carpeta] = process.argv.slice(2);
  if (!carpeta) {
    throw new Error(
      "Uso: node scripts/dashboards/datos-allure.mjs <carpeta de resultados>",
    );
  }
  const r = await completarCarpeta(carpeta);
  console.log(
    `Allure: ${r.resultados} resultados (${r.etiquetados} con área e historia), ` +
      `navegadores: ${r.navegadores.join(", ") || "—"}, ejecutor: ${r.ejecutor ? "sí" : "no"}.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
