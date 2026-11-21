#!/usr/bin/env node
// BL-487: deja los resultados de Allure de los E2E listos para publicarse.
//
// El reporte se publica en GitHub Pages, que es público como el repositorio.
// Los resultados crudos de Playwright tienen datos que no pueden quedar ahí:
//   - Los pasos «Fill» y «Type» muestran el texto escrito, por ejemplo la
//     contraseña de un usuario de prueba en el login de Keycloak.
//   - Las trazas (trace.zip), el contexto del error, los videos y la salida
//     de consola pueden tener contraseñas, tokens y encabezados de las llamadas.
//
// Este script, sobre la carpeta de resultados (*-result.json y
// *-container.json):
//   1. Reemplaza el texto de los pasos que escriben en un campo por «•••».
//   2. Deja solo los adjuntos de imagen (capturas de pantalla y comparaciones
//      visuales) y borra los archivos del resto.
// El detalle completo queda en el reporte HTML de cada navegador, que el CI
// sube cifrado (artifact playwright-report-<proyecto>, ver e2e/README.md).
// El CI corre este script en cada job de Playwright, antes de subir los
// resultados, y otra vez al juntarlos (no cambia nada si ya están listos).
//
// Sin dependencias. Termina con error si la carpeta no tiene resultados, para
// no publicar un reporte vacío: el sitio conserva el último reporte bueno.
//
// Uso: node scripts/dashboards/sanitizar-allure.mjs <carpeta de resultados>

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Pasos de Playwright que escriben texto. Su título trae el valor:
// Fill "<texto>", Type "<texto>", Press sequentially "<texto>".
const PASO_QUE_ESCRIBE = /^(Fill|Type|Press sequentially)\b/;
export const OCULTO = "•••";

/** Título de un paso sin el texto escrito, o el mismo si no escribe nada. */
export function ocultarTexto(nombre) {
  if (typeof nombre !== "string") return nombre;
  const m = nombre.match(PASO_QUE_ESCRIBE);
  return m ? `${m[1]} "${OCULTO}"` : nombre;
}

/** Solo se publican imágenes: capturas y comparaciones visuales. */
export function adjuntoPublicable(adjunto) {
  return typeof adjunto?.type === "string" && adjunto.type.startsWith("image/");
}

/**
 * Sanitiza un resultado o contenedor de Allure (lo modifica en el lugar).
 * Devuelve los archivos de los adjuntos que se quitaron.
 */
export function sanitizarObjeto(objeto) {
  const quitados = [];

  const visitar = (nodo) => {
    if (Array.isArray(nodo)) {
      nodo.forEach(visitar);
      return;
    }
    if (!nodo || typeof nodo !== "object") return;

    if (Array.isArray(nodo.attachments)) {
      for (const adjunto of nodo.attachments) {
        if (!adjuntoPublicable(adjunto) && adjunto?.source)
          quitados.push(adjunto.source);
      }
      nodo.attachments = nodo.attachments.filter(adjuntoPublicable);
    }

    // Un paso (o un hook de un contenedor) que escribe texto: se oculta el
    // texto y se quitan sus parámetros, que podrían repetirlo.
    if (typeof nodo.name === "string" && PASO_QUE_ESCRIBE.test(nodo.name)) {
      nodo.name = ocultarTexto(nodo.name);
      if (Array.isArray(nodo.parameters)) nodo.parameters = [];
    }

    for (const clave of ["steps", "befores", "afters"]) {
      if (nodo[clave]) visitar(nodo[clave]);
    }
  };

  visitar(objeto);
  return quitados;
}

const ES_RESULTADO = /-(result|container)\.json$/;

/** Sanitiza todos los resultados de la carpeta y borra los adjuntos quitados. */
export async function sanitizarCarpeta(carpeta) {
  const archivos = await fs.readdir(carpeta);
  const resultados = archivos.filter((a) => a.endsWith("-result.json"));
  if (resultados.length === 0) {
    throw new Error(`No hay resultados de Allure en ${carpeta}`);
  }

  const quitados = new Set();
  let pasosOcultos = 0;
  for (const archivo of archivos.filter((a) => ES_RESULTADO.test(a))) {
    const ruta = path.join(carpeta, archivo);
    const objeto = JSON.parse(await fs.readFile(ruta, "utf-8"));
    for (const fuente of sanitizarObjeto(objeto)) quitados.add(fuente);
    const sanitizado = JSON.stringify(objeto);
    pasosOcultos += sanitizado.split(OCULTO).length - 1;
    await fs.writeFile(ruta, sanitizado, "utf-8");
  }

  // path.basename: un "source" con «../» no puede borrar fuera de la carpeta.
  for (const fuente of quitados) {
    await fs.rm(path.join(carpeta, path.basename(fuente)), { force: true });
  }

  return {
    resultados: resultados.length,
    adjuntosQuitados: quitados.size,
    pasosOcultos,
  };
}

async function main() {
  const carpeta = process.argv[2];
  if (!carpeta) {
    throw new Error(
      "Uso: node scripts/dashboards/sanitizar-allure.mjs <carpeta de resultados>",
    );
  }
  const { resultados, adjuntosQuitados, pasosOcultos } =
    await sanitizarCarpeta(carpeta);
  console.log(
    `✅ Allure: ${resultados} resultados listos para publicar ` +
      `(${pasosOcultos} pasos con texto oculto, ${adjuntosQuitados} adjuntos no publicables quitados).`,
  );
}

// Solo corre main() si se ejecuta directo (no al importarlo desde un test).
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    console.error(
      "❌ No se pudieron preparar los resultados de Allure:",
      err.message,
    );
    process.exit(1);
  });
}
