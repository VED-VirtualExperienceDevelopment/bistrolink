// BL-243: tests del enlace al estado del servicio en el sitio de dashboards.
// BL-487: tests del enlace al reporte Allure de los E2E.
// Sin dependencias:
//   node --test scripts/dashboards/publicar-dashboards.test.mjs

import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  ALLURE_RUTA,
  enlacesExternos,
  listaEnEspanol,
  pagina,
  reporteAllure,
} from "./publicar-dashboards.mjs";

const PUBLICO = "https://bistrolink.grafana.net/public-dashboards/abc123";

describe("enlacesExternos", () => {
  test("sin variable no agrega ningún enlace", () => {
    assert.deepEqual(enlacesExternos(undefined), []);
    assert.deepEqual(enlacesExternos(""), []);
  });

  test("con un dashboard público de Grafana Cloud agrega el enlace al estado", () => {
    const [enlace] = enlacesExternos(`  ${PUBLICO}  `);
    assert.equal(enlace.url, PUBLICO);
    assert.equal(enlace.titulo, "Estado del servicio");
  });

  test("rechaza lo que no es un dashboard público de Grafana Cloud", () => {
    for (const url of [
      "no es una url",
      "http://bistrolink.grafana.net/public-dashboards/abc123", // sin HTTPS
      "https://bistrolink.grafana.net/goto/abc123", // link interno, pide login
      "https://bistrolink.grafana.net.ejemplo.com/public-dashboards/abc123",
      "javascript:alert(1)",
    ]) {
      assert.deepEqual(enlacesExternos(url), [], url);
    }
  });
});

describe("pagina", () => {
  const base = {
    titulo: "Dashboards",
    contenido: "",
    actualizado: "08/11/2026",
    conMermaid: false,
  };

  test("sin enlaces externos el menú no cambia", () => {
    const html = pagina(base);
    assert.ok(!html.includes("Estado del servicio"));
  });

  test("el enlace al estado abre en otra pestaña sin acceso a esta", () => {
    const html = pagina({ ...base, externos: enlacesExternos(PUBLICO) });
    // Comparación literal (no RegExp): los "." de la URL no actúan como comodín.
    const esperado = `<a href="${PUBLICO}" target="_blank" rel="noopener noreferrer">Estado del servicio ↗</a>`;
    assert.ok(
      html.includes(esperado),
      `no se encontró el enlace esperado:\n${esperado}`,
    );
  });
});

describe("reporteAllure", () => {
  test("sin carpeta no agrega ningún enlace", async () => {
    assert.deepEqual(await reporteAllure(undefined), []);
    assert.deepEqual(await reporteAllure(""), []);
  });

  test("con una carpeta sin index.html no agrega el enlace", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "allure-sitio-"));
    try {
      assert.deepEqual(await reporteAllure(dir), []);
      assert.deepEqual(await reporteAllure(path.join(dir, "no-existe")), []);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("con el reporte generado agrega el enlace interno a /allure/e2e/", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "allure-sitio-"));
    try {
      await fs.writeFile(path.join(dir, "index.html"), "<!doctype html>");
      const [reporte] = await reporteAllure(dir);
      assert.equal(reporte.carpeta, dir);
      assert.equal(reporte.ruta, ALLURE_RUTA);
      assert.equal(reporte.titulo, "Reporte E2E (Allure)");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("pagina con el reporte Allure", () => {
  const base = {
    titulo: "Dashboards",
    contenido: "",
    actualizado: "21/11/2026",
    conMermaid: false,
  };

  test("el menú enlaza al reporte en la misma pestaña", () => {
    const internos = [{ ruta: ALLURE_RUTA, titulo: "Reporte E2E (Allure)" }];
    const html = pagina({ ...base, internos });
    assert.ok(
      html.includes(`<a href="./${ALLURE_RUTA}">Reporte E2E (Allure)</a>`),
    );
  });

  test("sin reporte el menú no lo muestra", () => {
    assert.ok(!pagina(base).includes("Allure"));
  });
});

describe("listaEnEspanol", () => {
  test("enumera con comas e «y» antes del último", () => {
    assert.equal(listaEnEspanol([]), "");
    assert.equal(listaEnEspanol(["Linear"]), "Linear");
    assert.equal(
      listaEnEspanol(["Linear", "GitHub Issues"]),
      "Linear y GitHub Issues",
    );
    assert.equal(
      listaEnEspanol([
        "Linear",
        "GitHub Issues",
        "los E2E de Playwright",
        "Grafana",
      ]),
      "Linear, GitHub Issues, los E2E de Playwright y Grafana",
    );
  });
});
