// BL-243: tests del enlace al estado del servicio en el sitio de dashboards.
// Sin dependencias:
//   node --test scripts/publicar-dashboards.test.mjs

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { enlacesExternos, pagina } from "./publicar-dashboards.mjs";

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
  const base = { titulo: "Dashboards", contenido: "", actualizado: "08/11/2026", conMermaid: false };

  test("sin enlaces externos el menú no cambia", () => {
    const html = pagina(base);
    assert.ok(!html.includes("Estado del servicio"));
  });

  test("el enlace al estado abre en otra pestaña sin acceso a esta", () => {
    const html = pagina({ ...base, externos: enlacesExternos(PUBLICO) });
    assert.match(
      html,
      new RegExp(`<a href="${PUBLICO}" target="_blank" rel="noopener noreferrer">Estado del servicio ↗</a>`),
    );
  });
});
