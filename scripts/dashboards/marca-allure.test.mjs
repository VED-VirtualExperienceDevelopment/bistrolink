// BL-597: tests de la marca de BistroLink en el reporte Allure.
// Sin dependencias:
//   node --test scripts/dashboards/marca-allure.test.mjs

import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ARCHIVOS_MARCA,
  CARPETA_MARCA,
  MARCADOR,
  aplicarMarca,
  conMarca,
} from "./marca-allure.mjs";

const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <title>BistroLink — E2E</title>
</head>
<body><script src="assets/index.js"></script></body>
</html>`;

describe("conMarca", () => {
  test("agrega el ícono y la hoja de estilos antes de </head>", () => {
    const html = conMarca(HTML);
    const head = html.slice(0, html.indexOf("</head>"));
    assert.ok(head.includes(`href="${CARPETA_MARCA}/logo.svg"`));
    assert.ok(head.includes(`href="${CARPETA_MARCA}/bistrolink.css"`));
    assert.ok(!head.includes("<script"), "la marca no agrega scripts");
  });

  test("no repite la marca si ya está", () => {
    const una = conMarca(HTML);
    assert.equal(conMarca(una), una);
    assert.equal(una.split(MARCADOR).length - 1, 1);
  });

  test("sin </head>, falla", () => {
    assert.throws(() => conMarca("<html><body></body></html>"), /sin <\/head>/);
  });
});

describe("aplicarMarca", () => {
  test("copia los archivos de la marca y modifica index.html", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "allure-marca-"));
    try {
      // Raíz falsa con los archivos de origen, para no depender del repo.
      const raiz = path.join(tmp, "repo");
      for (const [origen] of ARCHIVOS_MARCA) {
        await fs.mkdir(path.dirname(path.join(raiz, origen)), {
          recursive: true,
        });
        await fs.writeFile(path.join(raiz, origen), `contenido de ${origen}`);
      }
      const reporte = path.join(tmp, "reporte");
      await fs.mkdir(reporte);
      await fs.writeFile(path.join(reporte, "index.html"), HTML);

      const r = await aplicarMarca(reporte, raiz);
      assert.deepEqual(r, {
        archivos: ARCHIVOS_MARCA.length,
        yaAplicada: false,
      });
      for (const [origen, nombre] of ARCHIVOS_MARCA) {
        const copia = await fs.readFile(
          path.join(reporte, CARPETA_MARCA, nombre),
          "utf-8",
        );
        assert.equal(copia, `contenido de ${origen}`);
      }
      const html = await fs.readFile(path.join(reporte, "index.html"), "utf-8");
      assert.ok(html.includes(MARCADOR));

      const otraVez = await aplicarMarca(reporte, raiz);
      assert.equal(otraVez.yaAplicada, true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("los archivos de origen existen en el repo", async () => {
    const raiz = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
    );
    for (const [origen] of ARCHIVOS_MARCA) {
      await assert.doesNotReject(fs.access(path.join(raiz, origen)), origen);
    }
  });
});
