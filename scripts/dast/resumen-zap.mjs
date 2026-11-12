// scripts/dast/resumen-zap.mjs
//
// BL-218: lee el informe JSON de OWASP ZAP (opción -J de los scans
// empaquetados) y decide si la corrida pasa. Escribe un resumen en Markdown
// para el resumen del job de GitHub Actions.
//
// Criterio de salida (Anexo 11, «Seguridad dinámica»): sin hallazgos de riesgo
// alto. Los medios no fallan el job: se listan para registrarlos como defectos
// en GitHub Issues con su severidad (Anexo 11 §9.5).
//
// Las alertas que el equipo revisó y descartó (falso positivo o riesgo
// aceptado) van en reglas-zap.tsv con IGNORE y su motivo. ZAP usa el mismo
// archivo con -c, y este script lo vuelve a leer para no contarlas aunque
// aparezcan en el informe.
//
// BL-525: el repositorio es público, así que el resumen del job y el log los
// puede ver cualquiera. Con --detalle no (modo completo) solo se publican las
// cantidades por riesgo y si la corrida pasa: sin alertas, URLs ni motivos.
// El detalle queda en el informe cifrado (ver docs/security/dast.md).
//
// Sin dependencias. Uso:
//   node scripts/dast/resumen-zap.mjs --informe zap/web.json --objetivo web \
//     [--reglas scripts/dast/reglas-zap.tsv] [--falla-con alto|medio] \
//     [--detalle si|no]
// Sale con 1 si hay alertas del nivel de --falla-con o más (por defecto, alto).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RIESGOS = ["Informativo", "Bajo", "Medio", "Alto"];
const NIVEL_FALLA = { medio: 2, alto: 3 };

// --- Reglas ------------------------------------------------------------------

// Formato de ZAP: id <TAB> IGNORE|INFO|WARN|FAIL <TAB> comentario. Las líneas
// que empiezan con # son comentarios.
export function leerReglas(texto) {
  const reglas = new Map();
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim() || linea.trimStart().startsWith("#")) continue;
    const [id, accion, ...resto] = linea.split("\t");
    if (!/^\d+$/.test(id?.trim() ?? "")) continue;
    reglas.set(id.trim(), {
      accion: (accion ?? "").trim().toUpperCase(),
      motivo: resto.join(" ").trim(),
    });
  }
  return reglas;
}

// --- Informe -----------------------------------------------------------------

export function resumirInforme(informe, reglas = new Map()) {
  const alertas = [];
  for (const sitio of informe.site ?? []) {
    for (const a of sitio.alerts ?? []) {
      const id = String(a.pluginid ?? a.alertRef ?? "");
      const regla = reglas.get(id);
      const instancias = a.instances ?? [];
      alertas.push({
        id,
        nombre: a.name ?? a.alert ?? "(sin nombre)",
        riesgo: Number(a.riskcode ?? 0),
        confianza: Number(a.confidence ?? 0),
        cantidad: Number(a.count ?? instancias.length),
        ejemplo: instancias[0]
          ? `${instancias[0].method ?? "GET"} ${instancias[0].uri}`
          : sitio["@name"],
        cwe: a.cweid && a.cweid !== "-1" ? a.cweid : null,
        ignorada: regla?.accion === "IGNORE",
        motivo: regla?.accion === "IGNORE" ? regla.motivo : null,
      });
    }
  }
  // Mayor riesgo primero; a igual riesgo, más instancias primero.
  alertas.sort(
    (a, b) =>
      b.riesgo - a.riesgo ||
      b.cantidad - a.cantidad ||
      a.id.localeCompare(b.id),
  );

  const vigentes = alertas.filter((a) => !a.ignorada);
  const porRiesgo = RIESGOS.map(
    (_, r) => vigentes.filter((a) => a.riesgo === r).length,
  );
  return {
    alertas,
    vigentes,
    porRiesgo,
    ignoradas: alertas.filter((a) => a.ignorada),
  };
}

export function falla(resumen, fallaCon = "alto") {
  const nivel = NIVEL_FALLA[fallaCon] ?? NIVEL_FALLA.alto;
  return resumen.vigentes.some((a) => a.riesgo >= nivel);
}

// --- Markdown ----------------------------------------------------------------

function celda(texto) {
  return String(texto ?? "—")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

export const AVISO_SIN_DETALLE =
  "> El detalle de las alertas no se publica: el repositorio es público. Está en el informe cifrado (artifact `dast-completo-api`); ver `docs/security/dast.md`.";

export function renderMarkdown(
  resumen,
  objetivo,
  fallaCon = "alto",
  detalle = true,
) {
  const [info, bajo, medio, alto] = resumen.porRiesgo;
  const estado = falla(resumen, fallaCon)
    ? `❌ Hay hallazgos de riesgo ${fallaCon} o mayor`
    : "✅ Sin hallazgos de riesgo alto";
  const lineas = [
    `### DAST — ${objetivo}`,
    "",
    `${estado}. Alto: **${alto}** · Medio: **${medio}** · Bajo: ${bajo} · Informativo: ${info}` +
      (resumen.ignoradas.length
        ? ` · Revisadas e ignoradas: ${resumen.ignoradas.length}`
        : ""),
    "",
  ];

  if (!detalle) {
    lineas.push(AVISO_SIN_DETALLE, "");
    if (alto || medio) {
      lineas.push(
        "> Las alertas altas o medias se gestionan con un aviso de seguridad privado (Security → Advisories), no con un issue público.",
        "",
      );
    }
    return lineas.join("\n");
  }

  const aMostrar = resumen.vigentes.filter((a) => a.riesgo >= 1);
  if (aMostrar.length) {
    lineas.push(
      "| Riesgo | Alerta | ID | CWE | Instancias | Ejemplo |",
      "|---|---|---|---|---|---|",
      ...aMostrar.map(
        (a) =>
          `| ${RIESGOS[a.riesgo]} | ${celda(a.nombre)} | ${a.id} | ${a.cwe ?? "—"} | ${a.cantidad} | ${celda(a.ejemplo)} |`,
      ),
      "",
    );
  }
  if (resumen.ignoradas.length) {
    lineas.push(
      "<details><summary>Revisadas e ignoradas (reglas-zap.tsv)</summary>",
      "",
      "| Riesgo | Alerta | ID | Motivo |",
      "|---|---|---|---|",
      ...resumen.ignoradas.map(
        (a) =>
          `| ${RIESGOS[a.riesgo]} | ${celda(a.nombre)} | ${a.id} | ${celda(a.motivo)} |`,
      ),
      "",
      "</details>",
      "",
    );
  }
  if (medio) {
    lineas.push(
      "> Registrar cada alerta media como defecto en GitHub Issues, con su severidad y plazo (Anexo 11 §9.5).",
      "",
    );
  }
  return lineas.join("\n");
}

// --- main --------------------------------------------------------------------

function argumentos(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2)
    args[argv[i].replace(/^--/, "")] = argv[i + 1];
  return args;
}

// Anotaciones del job (aparecen en la página de la corrida). Sin detalle,
// una sola anotación con las cantidades, sin nombres de alertas ni URLs.
export function anotaciones(resumen, objetivo, detalle = true) {
  const relevantes = resumen.vigentes.filter((a) => a.riesgo >= 2);
  if (!detalle) {
    if (!relevantes.length) return [];
    const [, , medio, alto] = resumen.porRiesgo;
    const tipo = alto ? "error" : "warning";
    return [
      `::${tipo} title=ZAP ${objetivo}::Alto: ${alto} · Medio: ${medio}. Detalle en el informe cifrado.`,
    ];
  }
  return relevantes.map((a) => {
    const tipo = a.riesgo >= 3 ? "error" : "warning";
    return `::${tipo} title=ZAP ${objetivo}: ${RIESGOS[a.riesgo]}::${a.nombre} (${a.id}) — ${a.ejemplo}`;
  });
}

function main() {
  const args = argumentos(process.argv.slice(2));
  if (!args.informe || !args.objetivo) {
    console.error(
      "Uso: node scripts/dast/resumen-zap.mjs --informe <zap.json> --objetivo <nombre> [--reglas <tsv>] [--falla-con alto|medio] [--detalle si|no]",
    );
    process.exit(2);
  }
  if (!fs.existsSync(args.informe)) {
    console.error(
      `❌ No está el informe ${args.informe}: ZAP no terminó el scan (revisá el paso anterior).`,
    );
    process.exit(2);
  }
  const detalle = args.detalle !== "no";
  const reglas =
    args.reglas && fs.existsSync(args.reglas)
      ? leerReglas(fs.readFileSync(args.reglas, "utf-8"))
      : new Map();
  const resumen = resumirInforme(
    JSON.parse(fs.readFileSync(args.informe, "utf-8")),
    reglas,
  );
  const md = renderMarkdown(resumen, args.objetivo, args["falla-con"], detalle);

  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  for (const linea of anotaciones(resumen, args.objetivo, detalle))
    console.log(linea);
  process.exit(falla(resumen, args["falla-con"]) ? 1 : 0);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
