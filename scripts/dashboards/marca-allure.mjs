#!/usr/bin/env node
// BL-597: aplica la marca de BistroLink al reporte Allure ya generado.
//
// Copia a <reporte>/marca/:
//   - bistrolink.css: scripts/dashboards/allure-marca.css (colores, fuente,
//     ícono y nombre en la barra lateral).
//   - logo.svg: el ícono de la app (apps/frontend/src/app/icon.svg).
//   - plus-jakarta-sans.woff2 y su licencia (SIL OFL 1.1), los mismos
//     archivos que usa la web (apps/frontend/src/app/fonts).
// y agrega al <head> de index.html el ícono de la pestaña y la hoja de
// estilos. Se puede correr más de una vez: si ya está aplicada, no repite.
//
// No toca los datos del reporte ni agrega scripts: solo estilos e imágenes
// propias, servidas desde el mismo sitio. Sin dependencias.
//
// Uso: node scripts/dashboards/marca-allure.mjs <carpeta del reporte>

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..");

export const CARPETA_MARCA = "marca";
export const MARCADOR = "<!-- BL-597: marca de BistroLink -->";

// Origen (desde la raíz del repo) → nombre dentro de <reporte>/marca/.
export const ARCHIVOS_MARCA = [
  ["scripts/dashboards/allure-marca.css", "bistrolink.css"],
  ["apps/frontend/src/app/icon.svg", "logo.svg"],
  [
    "apps/frontend/src/app/fonts/plus-jakarta-sans-latin-wght-normal.woff2",
    "plus-jakarta-sans.woff2",
  ],
  [
    "apps/frontend/src/app/fonts/PlusJakartaSans-OFL.txt",
    "PlusJakartaSans-OFL.txt",
  ],
];

export const ETIQUETAS_HEAD = [
  MARCADOR,
  `<link rel="icon" type="image/svg+xml" href="${CARPETA_MARCA}/logo.svg">`,
  `<link rel="stylesheet" href="${CARPETA_MARCA}/bistrolink.css">`,
].join("\n    ");

/** index.html con el ícono y la hoja de estilos, sin repetirlos. */
export function conMarca(html) {
  if (html.includes(MARCADOR)) return html;
  const cierre = html.search(/<\/head>/i);
  if (cierre === -1) {
    throw new Error("index.html sin </head>: no se puede aplicar la marca");
  }
  return `${html.slice(0, cierre)}    ${ETIQUETAS_HEAD}\n${html.slice(cierre)}`;
}

/** Copia los archivos de la marca y modifica index.html del reporte. */
export async function aplicarMarca(reporte, raiz = RAIZ) {
  const indice = path.join(reporte, "index.html");
  const html = await fs.readFile(indice, "utf-8");

  const destino = path.join(reporte, CARPETA_MARCA);
  await fs.mkdir(destino, { recursive: true });
  for (const [origen, nombre] of ARCHIVOS_MARCA) {
    await fs.copyFile(path.join(raiz, origen), path.join(destino, nombre));
  }

  const nuevo = conMarca(html);
  if (nuevo !== html) await fs.writeFile(indice, nuevo, "utf-8");
  return { archivos: ARCHIVOS_MARCA.length, yaAplicada: nuevo === html };
}

async function main() {
  const [reporte] = process.argv.slice(2);
  if (!reporte) {
    throw new Error(
      "Uso: node scripts/dashboards/marca-allure.mjs <carpeta del reporte>",
    );
  }
  const r = await aplicarMarca(reporte);
  console.log(
    r.yaAplicada
      ? "Marca de BistroLink: ya estaba aplicada."
      : `Marca de BistroLink aplicada (${r.archivos} archivos en ${CARPETA_MARCA}/).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
