#!/usr/bin/env node
/**
 * BL-437: traduce el resultado de Lighthouse CI a un JUnit XML con el caso
 * TC-P-003, para subirlo a Kiwi TCMS, y escribe el resumen de la corrida en
 * GitHub (los puntajes de cada corrida, sin descargar nada).
 *
 * Lee el manifest.json que deja `lhci autorun` en el outputDir de
 * lighthouserc.json (lighthouse-results/). Toma la corrida representativa
 * (la mediana que elige lhci) y compara su puntaje de performance con el
 * mínimo de lighthouserc.json (0.8).
 *
 * Uso (desde la raíz del repo):
 *
 *   node scripts/kiwi/lighthouse-a-junit.mjs [salida.xml]
 *
 * Sin manifest (lhci no llegó a medir), el caso queda fallido con el motivo.
 * Nunca termina con error: el que decide si el job falla es lhci.
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

// Tiene que ser IDÉNTICO al título del caso en Kiwi (plan
// «Performance-k6-Lighthouse») y al de .github/workflows/performance.yml.
const TITULO =
  "[TC-P-003] HU-001: performance Lighthouse del menú digital en celular (score ≥ 0.8)";
const MINIMO = 0.8;
const MANIFEST = "lighthouse-results/manifest.json";
const SALIDA = process.argv[2] ?? "lighthouse-junit.xml";

const CATEGORIAS = [
  ["performance", "Performance"],
  ["accessibility", "Accesibilidad"],
  ["best-practices", "Buenas prácticas"],
  ["seo", "SEO"],
];

const escaparXml = (texto) =>
  String(texto)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const puntaje = (valor) =>
  typeof valor === "number" ? String(Math.round(valor * 100)) : "—";

let corridas = [];
if (existsSync(MANIFEST)) {
  corridas = JSON.parse(readFileSync(MANIFEST, "utf8"));
}
const representativa =
  corridas.find((c) => c.isRepresentativeRun) ?? corridas.at(-1);
const performance = representativa?.summary?.performance;
const paso = typeof performance === "number" && performance >= MINIMO;

let detalle;
if (!representativa) {
  detalle = `No se encontró ${MANIFEST}: Lighthouse no llegó a medir.`;
} else {
  detalle = `URL: ${representativa.url}\nPerformance de la corrida representativa: ${puntaje(performance)} (mínimo ${MINIMO * 100}).`;
}

// JUnit: un solo caso. Sin classname, así el título del caso en Kiwi es el
// nombre del testcase (--summary-template '${name}').
const xml = [
  '<?xml version="1.0" encoding="utf-8"?>',
  "<testsuites>",
  `  <testsuite name="lighthouse" tests="1" failures="${paso ? 0 : 1}">`,
  `    <testcase classname="" name="${escaparXml(TITULO)}" time="0">`,
  paso
    ? ""
    : `      <failure message="umbral no cumplido">${escaparXml(detalle)}</failure>`,
  `      <system-out>${escaparXml(detalle)}</system-out>`,
  "    </testcase>",
  "  </testsuite>",
  "</testsuites>",
  "",
]
  .filter((linea) => linea !== "")
  .join("\n");
writeFileSync(SALIDA, `${xml}\n`);

// Resumen de la corrida en GitHub (pestaña Summary).
const filas = corridas.map((c, i) => {
  const valores = CATEGORIAS.map(([clave]) => puntaje(c.summary?.[clave]));
  const marca = c.isRepresentativeRun ? " (representativa)" : "";
  return `| ${i + 1}${marca} | ${valores.join(" | ")} |`;
});
const resumen = [
  "## 🔦 Lighthouse (celular) — staging",
  "",
  representativa
    ? `**${paso ? "✅" : "❌"} Performance ${puntaje(performance)}** (mínimo ${MINIMO * 100}) en ${representativa.url}`
    : `**❌** ${detalle}`,
  "",
  ...(filas.length > 0
    ? [
        `| Corrida | ${CATEGORIAS.map(([, nombre]) => nombre).join(" | ")} |`,
        `|---|${CATEGORIAS.map(() => "---").join("|")}|`,
        ...filas,
        "",
        "Informes HTML completos en el artifact `lighthouse-report`.",
      ]
    : []),
  "",
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, resumen);
}
console.log(resumen);
console.log(`JUnit: ${SALIDA} (${paso ? "pasa" : "falla"}).`);
