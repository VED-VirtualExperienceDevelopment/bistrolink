// BL-601: tests del resumen de pruebas por corrida.
//   node --test scripts/dashboards/resumen-pruebas.test.mjs

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  duracion,
  parsearArgumentos,
  parsearEntrada,
  renderResumen,
  totalesJunit,
} from "./resumen-pruebas.mjs";

const JEST = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="jest tests" tests="4" failures="1" errors="0" time="12.5">
  <testsuite name="pedidos" tests="3" time="10">
    <testcase classname="pedidos" name="crea un pedido" time="0.5"></testcase>
    <testcase classname="pedidos" name="rechaza sin mesa &amp; sin tenant" time="0.1">
      <failure message="Expected 400">Error: Expected 400\n at ...</failure>
    </testcase>
    <testcase classname="pedidos" name="pendiente" time="0"><skipped/></testcase>
  </testsuite>
  <testsuite name="pagos" tests="1" time="2.5">
    <testcase classname="pagos" name="aprueba" time="0.2"/>
  </testsuite>
</testsuites>`;

describe("totalesJunit", () => {
  test("cuenta pasan, fallan y salteados por testcase", () => {
    const t = totalesJunit(JEST);
    assert.equal(t.total, 4);
    assert.equal(t.pasan, 2);
    assert.equal(t.fallan, 1);
    assert.equal(t.salteados, 1);
    assert.equal(t.segundos, 12.5);
    assert.deepEqual(t.fallidos, ["rechaza sin mesa & sin tenant"]);
  });

  test("sin tiempo en la raíz, suma el de las suites", () => {
    const xml = `<testsuite name="a" time="3"><testcase name="x"/></testsuite><testsuite name="b" time="4.5"><testcase name="y"><error/></testcase></testsuite>`;
    const t = totalesJunit(xml);
    assert.equal(t.segundos, 7.5);
    assert.equal(t.fallan, 1);
  });
});

describe("formato", () => {
  test("duración legible", () => {
    assert.equal(duracion(0), "—");
    assert.equal(duracion(12.4), "12 s");
    assert.equal(duracion(125), "2 min 5 s");
    assert.equal(duracion(120), "2 min");
  });

  test("entrada con y sin etiqueta", () => {
    assert.deepEqual(parsearEntrada("Backend=apps/backend/coverage/junit.xml"), {
      etiqueta: "Backend",
      ruta: "apps/backend/coverage/junit.xml",
    });
    assert.equal(parsearEntrada("reports/junit.xml").etiqueta, "junit.xml");
  });

  test("argumentos", () => {
    const op = parsearArgumentos(["--titulo", "🧪 Jest", "--artifact", "cov", "Backend=a.xml", "b.xml"]);
    assert.equal(op.titulo, "🧪 Jest");
    assert.equal(op.artifact, "cov");
    assert.equal(op.entradas.length, 2);
  });
});

describe("renderResumen", () => {
  test("tabla con total, lista de fallidos y enlaces", () => {
    const md = renderResumen(
      "🧪 Tests unitarios",
      [
        { etiqueta: "Backend", totales: totalesJunit(JEST) },
        { etiqueta: "Frontend", totales: { total: 2, pasan: 2, fallan: 0, salteados: 0, segundos: 3, fallidos: [] } },
      ],
      { artifact: "coverage-report-backend", corrida: "https://github.com/o/r/actions/runs/1", kiwi: "Integration tests" },
    );
    assert.match(md, /### 🧪 Tests unitarios/);
    assert.match(md, /\| Backend \| 4 \| 2 \| 1 \| 1 \| 13 s \| ❌ \|/);
    assert.match(md, /\| \*\*Total\*\* \| \*\*6\*\* \| \*\*4\*\* \| \*\*1\*\*/);
    assert.match(md, /- Backend › rechaza sin mesa & sin tenant/);
    assert.match(md, /artifact `coverage-report-backend` \(\[corrida\]/);
    assert.match(md, /Test Plan «Integration tests» en Kiwi TCMS/);
    // Nunca el mensaje de error.
    assert.ok(!md.includes("Expected 400"));
  });

  test("un archivo que falta queda como sin resultados", () => {
    const md = renderResumen("E2E", [{ etiqueta: "E2E", totales: null }]);
    assert.match(md, /Sin resultados/);
    assert.ok(!md.includes("**Total**"));
  });

  test("corta la lista de fallidos en 20", () => {
    const fallidos = Array.from({ length: 25 }, (_, i) => `t${i}`);
    const md = renderResumen("X", [{ etiqueta: "S", totales: { total: 25, pasan: 0, fallan: 25, salteados: 0, segundos: 1, fallidos } }]);
    assert.match(md, /… y 5 más/);
  });
});
