#!/usr/bin/env node
// BL-487: deja los resultados de Allure de los E2E listos para publicarse.
//
// El reporte se publica en GitHub Pages y el junit.xml va a Kiwi TCMS y a un
// artifact del CI: los tres son públicos o los ve más gente que el equipo.
// Los resultados crudos de Playwright tienen datos de las sesiones de prueba
// que no pueden quedar ahí:
//   - Los pasos «Fill», «Type» y «Press sequentially» muestran el texto que
//     se escribe en los campos.
//   - Cuando falla un pedido a la API, el mensaje de error incluye los
//     encabezados del pedido (authorization, cookie…).
//   - Las trazas, los videos, el contexto del error y la salida de consola.
//
// Sobre una carpeta de resultados de Allure (*-result.json y
// *-container.json), este script:
//   1. Reemplaza por «•••» el texto de los pasos que escriben en un campo.
//   2. Oculta los encabezados con credenciales y los tokens Bearer o Basic en
//      los mensajes de error.
//   3. Deja solo los adjuntos de imagen (capturas de pantalla y comparaciones
//      visuales) y borra los archivos del resto.
// Con --junit hace el punto 2 sobre un junit.xml.
//
// El CI lo corre en cada job de Playwright, antes de subir los resultados, y
// otra vez al juntarlos (si ya están listos, no cambia nada). El detalle
// completo queda en el reporte HTML de cada navegador, que el CI sube cifrado
// (artifact playwright-report-<proyecto>, ver e2e/README.md).
//
// Sin dependencias. Termina con error si la carpeta no tiene resultados, para
// no publicar un reporte vacío: el sitio conserva el último reporte bueno.
//
// Uso: node scripts/dashboards/sanitizar-allure.mjs <carpeta de resultados>
//      node scripts/dashboards/sanitizar-allure.mjs --junit <junit.xml>

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

// Encabezados con credenciales, como los escribe el call log de Playwright
// («  authorization: Bearer …») o un JSON («"authorization":"…"»). El valor
// termina en el fin de línea o en un carácter que lo cierra en XML o JSON.
const ENCABEZADO_SENSIBLE =
  /\b(proxy-authorization|authorization|set-cookie|cookie|x-api-key|x-auth-token)("?\s*:\s*"?)[^\r\n&<"]+/gi;
// Un token suelto, fuera de un encabezado.
const TOKEN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;

/** Texto sin credenciales: encabezados sensibles y tokens Bearer o Basic. */
export function ocultarCredenciales(texto) {
  if (typeof texto !== "string") return texto;
  return texto
    .replace(ENCABEZADO_SENSIBLE, `$1$2${OCULTO}`)
    .replace(TOKEN, `$1 ${OCULTO}`);
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

    // Mensaje y detalle del error (del test o de un paso).
    if (nodo.statusDetails && typeof nodo.statusDetails === "object") {
      for (const clave of ["message", "trace", "actual", "expected"]) {
        nodo.statusDetails[clave] = ocultarCredenciales(
          nodo.statusDetails[clave],
        );
      }
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
  let valoresOcultos = 0;
  for (const archivo of archivos.filter((a) => ES_RESULTADO.test(a))) {
    const ruta = path.join(carpeta, archivo);
    const objeto = JSON.parse(await fs.readFile(ruta, "utf-8"));
    for (const fuente of sanitizarObjeto(objeto)) quitados.add(fuente);
    const sanitizado = JSON.stringify(objeto);
    valoresOcultos += sanitizado.split(OCULTO).length - 1;
    await fs.writeFile(ruta, sanitizado, "utf-8");
  }

  // path.basename: un "source" con «../» no puede borrar fuera de la carpeta.
  for (const fuente of quitados) {
    await fs.rm(path.join(carpeta, path.basename(fuente)), { force: true });
  }

  return {
    resultados: resultados.length,
    adjuntosQuitados: quitados.size,
    valoresOcultos,
  };
}

/** Oculta las credenciales de un junit.xml (lo reescribe en el lugar). */
export async function sanitizarJunit(ruta) {
  const original = await fs.readFile(ruta, "utf-8");
  const sanitizado = ocultarCredenciales(original);
  await fs.writeFile(ruta, sanitizado, "utf-8");
  return {
    valoresOcultos:
      sanitizado.split(OCULTO).length - original.split(OCULTO).length,
  };
}

async function main() {
  const [opcion, ruta] = process.argv.slice(2);
  if (opcion === "--junit") {
    if (!ruta)
      throw new Error(
        "Uso: node scripts/dashboards/sanitizar-allure.mjs --junit <junit.xml>",
      );
    const { valoresOcultos } = await sanitizarJunit(ruta);
    console.log(
      `✅ JUnit: ${ruta} listo para Kiwi (${valoresOcultos} credenciales ocultas).`,
    );
    return;
  }
  if (!opcion) {
    throw new Error(
      "Uso: node scripts/dashboards/sanitizar-allure.mjs <carpeta de resultados>",
    );
  }
  const { resultados, adjuntosQuitados, valoresOcultos } =
    await sanitizarCarpeta(opcion);
  console.log(
    `✅ Allure: ${resultados} resultados listos para publicar ` +
      `(${valoresOcultos} valores ocultos, ${adjuntosQuitados} adjuntos no publicables quitados).`,
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
