// BL-493: tests del cálculo del avance del MVP y de los bloques del dashboard.
// Sin dependencias:
//   node --test scripts/dashboards/avance-mvp.test.mjs

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { calcularAvance, fechaLocal, indiceSprint, topeEje } from "./avance-mvp.mjs";
import { reemplazarBloque, renderBurnup, renderDashboard } from "./update-dashboard-from-linear.mjs";

const config = {
  lineaDeBase: { inicio: "2026-08-03", entrega: "2026-09-04", zonaHorariaHoras: -3 },
  sprints: [
    { nombre: "S1", inicio: "2026-08-03", fin: "2026-08-14", hito: "H1", spPlan: 5 },
    { nombre: "S2", inicio: "2026-08-17", fin: "2026-08-28", hito: "H2", spPlan: 8 },
    { nombre: "Cierre", inicio: "2026-08-31", fin: "2026-09-04", hito: "Entrega", spPlan: 0 },
  ],
};

const backlog = {
  alcance: { historias: 2, storyPoints: 13, solicitudesDeCambio: [{ hu: "HU-003", storyPoints: 3 }] },
  grupos: [
    { id: "nucleo", nombre: "Núcleo", emoji: "🟩", fechaPlan: "2026-08-14", hito: "H1" },
    { id: "cambio", nombre: "Solicitudes de cambio", emoji: "🟪", fechaPlan: "2026-08-28", hito: "H2" },
  ],
  historias: [
    { hu: "HU-001", linear: ["BL-1"], sp: 5, prioridad: "Must", grupo: "nucleo", nivel: 1 },
    { hu: "HU-002", linear: ["BL-2", "BL-3"], sp: 8, prioridad: "Should", grupo: "nucleo", nivel: 2 },
    { hu: "HU-003", linear: ["BL-4"], sp: 3, prioridad: "Should", grupo: "cambio", nivel: 1 },
  ],
  fueraDelMvp: [{ hu: "HU-009", linear: ["BL-9"], sp: 13, prioridad: "Could", nivel: 4, motivo: "Trabajo futuro" }],
  reclasificados: [{ linear: "BL-8", motivo: "Mejora técnica" }],
};

const issue = (id, extra = {}) => ({
  id,
  titulo: `Issue ${id}`,
  sp: 0,
  estado: "Todo",
  tipo: "unstarted",
  completado: null,
  padre: null,
  ...extra,
});
const hecho = (id, completado, extra = {}) => issue(id, { estado: "Done", tipo: "completed", completado, ...extra });

const issues = [
  hecho("BL-1", "2026-08-10T15:00:00Z", { titulo: "HU-001: menú", sp: 5 }),
  // HU-002: un issue cerrado y otro en curso → no está terminada.
  hecho("BL-2", "2026-08-20T15:00:00Z", { titulo: "HU-002: parte 1", sp: 8 }),
  issue("BL-3", { titulo: "HU-002: parte 2", estado: "In Progress", tipo: "started" }),
  // Cerrado el sábado 15/08 a las 23:30 de Uruguay (domingo 02:30 UTC): cuenta en S1.
  hecho("BL-4", "2026-08-16T02:30:00Z", { titulo: "HU-003: cambio", sp: 3 }),
  // Sub-issue de una HU: trabajo de historias.
  hecho("BL-5", "2026-08-11T12:00:00Z", { sp: 2, padre: "BL-1" }),
  // Trabajo técnico.
  hecho("BL-6", "2026-08-18T12:00:00Z", { titulo: "CI: pipeline", sp: 3 }),
  // Parece una HU y no está en el backlog.
  issue("BL-7", { titulo: "HU: algo nuevo" }),
  // Parece una HU pero está reclasificado.
  hecho("BL-8", "2026-08-19T12:00:00Z", { titulo: "HU: mejora", sp: 1 }),
  issue("BL-9", { titulo: "HU-009: futuro" }),
];

const hoy = new Date("2026-08-20T15:00:00Z"); // jueves de S2

describe("utilidades", () => {
  test("fechaLocal pasa de UTC a la hora de Uruguay", () => {
    assert.equal(fechaLocal("2026-08-16T02:30:00Z", -3), "2026-08-15");
    assert.equal(fechaLocal("2026-08-16T03:00:00Z", -3), "2026-08-16");
  });

  test("indiceSprint: antes del S1 cuenta en S1; el fin de semana, en el Sprint que terminó", () => {
    assert.equal(indiceSprint("2026-07-30", config.sprints), 0);
    assert.equal(indiceSprint("2026-08-15", config.sprints), 0);
    assert.equal(indiceSprint("2026-08-17", config.sprints), 1);
    assert.equal(indiceSprint("2026-12-01", config.sprints), 2);
  });

  test("topeEje: máximo + 10 % redondeado a decenas, mínimo 10", () => {
    assert.equal(topeEje([0, 0]), 10);
    assert.equal(topeEje([159], [211]), 240);
    assert.equal(topeEje([5, null, 8]), 10);
  });
});

describe("calcularAvance", () => {
  const av = calcularAvance({ issues, backlog, config, hoy });

  test("una HU está terminada solo si todos sus issues están Done", () => {
    const porHu = Object.fromEntries(av.historias.map((h) => [h.hu, h]));
    assert.equal(porHu["HU-001"].terminada, true);
    assert.equal(porHu["HU-002"].terminada, false);
    assert.equal(porHu["HU-002"].estado, "In Progress");
    assert.equal(porHu["HU-003"].sprintFin, 0);
  });

  test("el avance del MVP usa los SP del backlog, no todo Linear", () => {
    assert.deepEqual(
      { hu: av.mvp.hu, huTerminadas: av.mvp.huTerminadas, sp: av.mvp.sp, spTerminados: av.mvp.spTerminados },
      { hu: 3, huTerminadas: 2, sp: 16, spTerminados: 8 }
    );
    assert.equal(av.mvp.pct, 50);
  });

  test("prioridad y grupos", () => {
    const should = av.porPrioridad.find((p) => p.prioridad === "Should");
    assert.equal(should.spTerminados, 3);
    const cambio = av.grupos.find((g) => g.id === "cambio");
    assert.equal(cambio.fechaReal, "2026-08-15");
    assert.equal(av.grupos.find((g) => g.id === "nucleo").fechaReal, null);
  });

  test("sprint actual, burn-up y plan a la fecha", () => {
    assert.equal(av.sprintActual.nombre, "S2");
    assert.equal(av.sprintsCerrados, 1);
    assert.deepEqual(av.burnup.plan, [5, 13, 13]);
    assert.deepEqual(av.burnup.real, [8, 8, null]);
    assert.equal(av.planALaFecha, 5);
  });

  test("throughput separa historias (con sub-issues) de trabajo técnico", () => {
    assert.deepEqual(av.throughput[0], {
      sprint: "S1",
      historias: 10,
      tecnico: 0,
      issues: 3,
      issuesHistorias: 3,
      issuesTecnicos: 0,
    });
    assert.deepEqual(av.throughput[1], {
      sprint: "S2",
      historias: 8,
      tecnico: 4,
      issues: 3,
      issuesHistorias: 1,
      issuesTecnicos: 2,
    });
  });

  test("avisa de historias sin mapear, pero no de las reclasificadas ni de los sub-issues", () => {
    assert.equal(av.avisos.length, 1);
    assert.match(av.avisos[0], /BL-7/);
  });

  test("avisa si falta un issue o si el alcance declarado no coincide", () => {
    const otro = calcularAvance({
      issues: issues.filter((i) => i.id !== "BL-4"),
      backlog: { ...backlog, alcance: { ...backlog.alcance, storyPoints: 99 } },
      config,
      hoy,
    });
    assert.ok(otro.avisos.some((a) => a.includes("BL-4") && a.includes("no aparece")));
    assert.ok(otro.avisos.some((a) => a.includes("alcance declarado")));
  });
});

describe("dashboard", () => {
  const av = calcularAvance({ issues, backlog, config, hoy });

  test("el burn-up tiene una serie por Sprint y vacía los que no empezaron", () => {
    const md = renderBurnup(av);
    assert.match(md, /x-axis "Sprint" \["S1", "S2", "Cierre"\]/);
    assert.match(md, /bar "Real acumulado" \[8, 8, 0\]/);
    assert.match(md, /line "Plan de la Línea de Base" \[5, 13, 13\]/);
    assert.match(md, /line "Alcance vigente" \[16, 16, 16\]/);
  });

  test("reemplazarBloque no interpreta los $ del contenido", () => {
    const md = "a\n<!-- AUTO:x:start -->\nviejo\n<!-- AUTO:x:end -->\nb";
    assert.match(reemplazarBloque(md, "x", "cuesta $& y $1"), /cuesta \$& y \$1/);
  });

  test("la plantilla real tiene todos los bloques y quedan llenos", () => {
    const plantilla = readFileSync(new URL("../../docs/dashboard-avance-edt.md", import.meta.url), "utf-8");
    const md = renderDashboard(plantilla, av, backlog, config);
    for (const m of plantilla.matchAll(/<!-- AUTO:([\w-]+):start -->\n<!-- AUTO:\1:end -->/g)) {
      assert.doesNotMatch(md, new RegExp(`<!-- AUTO:${m[1]}:start -->\\n<!-- AUTO:${m[1]}:end -->`));
    }
    assert.match(md, /\*\*HU del MVP terminadas\*\* \| \*\*2 de 3\*\*/);
    assert.match(md, /\| HU-002 \| HU-002: parte 1 \| Should \| Salida controlada \| 8 \| In Progress \| BL-2, BL-3 \|/);
  });
});
