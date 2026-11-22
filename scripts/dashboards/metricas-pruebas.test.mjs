// BL-601: tests de la sección «Plan de pruebas» del dashboard.
//   node --test scripts/dashboards/metricas-pruebas.test.mjs

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  conteoRun,
  datosCodecov,
  fechaKiwi,
  renderCobertura,
  renderKiwi,
  resumenPlan,
} from "./metricas-pruebas.mjs";

const PLAN = {
  id: 6,
  nombre: "E2E-Playwright",
  runsTotales: 12,
  casos: [
    { id: 1, titulo: "[TC-E-001] Menú por QR" },
    { id: 2, titulo: "[TC-E-002] Pedido" },
    { id: 3, titulo: "[TC-E-003] Pago | tarjeta" },
  ],
  // Del más nuevo al más viejo.
  runs: [
    { id: 30, inicio: "2026-11-21 22:10:05", ejecuciones: [{ caso: 1, peso: 20 }, { caso: 2, peso: -10 }, { caso: 3, peso: 0 }] },
    { id: 29, inicio: "2026-11-20 10:00:00", ejecuciones: [{ caso: 1, peso: 20 }, { caso: 2, peso: 20 }] },
  ],
};

describe("Kiwi TCMS", () => {
  test("conteo de un run por el peso del estado", () => {
    const c = conteoRun(PLAN.runs[0]);
    assert.deepEqual(
      { aprobados: c.aprobados, fallidos: c.fallidos, sinEjecutar: c.sinEjecutar, ejecutados: c.ejecutados },
      { aprobados: 1, fallidos: 1, sinEjecutar: 1, ejecutados: 2 },
    );
    assert.equal(c.aprobacion, 0.5);
  });

  test("resumen del plan: último run, tendencia y nunca ejecutados", () => {
    const r = resumenPlan(PLAN);
    assert.equal(r.casos, 3);
    assert.equal(r.ultimo.id, 30);
    // De la más vieja a la más nueva.
    assert.deepEqual(r.tendencia, [1, 0.5]);
    assert.deepEqual(r.nunca.map((c) => c.id), [3]);
  });

  test("tabla con estado, detalle de casos nunca ejecutados y sin romper la tabla", () => {
    const md = renderKiwi({ planes: [PLAN, { id: 9, nombre: "Vacío", runsTotales: 0, casos: [], runs: [] }] });
    assert.match(md, /\| TP-6 E2E-Playwright \| 3 \| 21\/11 · 2 de 3 ejecutados \| 50 % \| 100 % → 50 % \| 1 \| 🔴 \|/);
    assert.ok(!md.includes("TP-9"), "un plan sin casos ni runs no se muestra");
    assert.match(md, /- \[TC-E-003\] Pago tarjeta/);
    assert.match(md, /\*\*Casos: 3\*\* \(Test Plans: 1\) · \*\*sin ninguna ejecución: 1\*\*/);
  });

  test("fecha de Kiwi", () => {
    assert.equal(fechaKiwi("2026-11-21 22:10:05"), "21/11");
    assert.equal(fechaKiwi(""), "—");
  });
});

describe("Codecov", () => {
  test("total y flags desde la API", () => {
    const c = datosCodecov(
      { branch: "develop", totals: { coverage: 83.47 } },
      { results: [{ flag_name: "backend", coverage: 85.1 }, { flag_name: "frontend", coverage: "41.2" }] },
    );
    assert.equal(c.total, 83.47);
    assert.deepEqual(c.flags.map((f) => f.cobertura), [85.1, 41.2]);
    const md = renderCobertura(c);
    assert.match(md, /\| \*\*Total\*\* \| 83,5 % \| — \|/);
    assert.match(md, /\| backend \| 85,1 % \| 🟢 \|/);
    assert.match(md, /\| frontend \| 41,2 % \| — \|/);
    assert.match(md, /rama `develop`/);
  });

  test("sin datos, el bloque lo dice", () => {
    assert.match(renderCobertura(datosCodecov(null, null)), /Sin datos/);
  });
});
