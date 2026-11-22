// BL-221: tests de las métricas DORA del dashboard «Calidad del proceso».
// Sin dependencias:
//   node --test scripts/dashboards/metricas-dora.test.mjs

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import {
  analizarProduccion,
  esHotfix,
  esPrDeCambio,
  frecuenciaPorSprint,
  leadTimePrs,
  percentil,
  porSemana,
  prsDeCommits,
  reemplazarBloque,
  renderFrecuencia,
  renderLeadTime,
  renderReleases,
  renderResumen,
  resultadoDeploy,
  resumenDora,
  semaforo,
  sprintDe,
  tipoDeploy,
} from "./metricas-dora.mjs";

const SPRINTS = [
  { nombre: "S7", inicio: "2026-10-26", fin: "2026-11-06" },
  { nombre: "S8", inicio: "2026-11-09", fin: "2026-11-20" },
  { nombre: "Cierre", inicio: "2026-11-23", fin: "2026-11-27" },
];

const d = (iso) => new Date(iso);

function deploy(ref, fin, estado = "exitoso", sha = "abcdef1234") {
  return { ref, sha, creado: d(fin), estado, fin: estado === "incompleto" ? null : d(fin) };
}

describe("clasificación de deploys", () => {
  test("tag semántico es release, rc es ensayo y una rama es rollback", () => {
    assert.equal(tipoDeploy("v0.5.0"), "release");
    assert.equal(tipoDeploy("v0.5.0-rc.1"), "ensayo");
    assert.equal(tipoDeploy("main"), "rollback");
  });

  test("un parche es hotfix y una versión menor no", () => {
    assert.equal(esHotfix("v0.5.1"), true);
    assert.equal(esHotfix("v0.6.0"), false);
    assert.equal(esHotfix("v0.6.0-rc.1"), false);
  });

  test("resultado: success gana aunque después quede inactive", () => {
    const r = resultadoDeploy([
      { state: "inactive", created_at: "2026-11-24T20:00:00Z" },
      { state: "success", created_at: "2026-11-08T19:40:00Z" },
      { state: "in_progress", created_at: "2026-11-08T19:36:00Z" },
      { state: "waiting", created_at: "2026-11-08T19:30:00Z" },
    ]);
    assert.equal(r.estado, "exitoso");
    assert.equal(r.fin.toISOString(), "2026-11-08T19:40:00.000Z");
  });

  test("resultado: failure sin success es fallido; sin ninguno, incompleto", () => {
    assert.equal(resultadoDeploy([{ state: "failure", created_at: "2026-11-08T19:40:00Z" }]).estado, "fallido");
    assert.equal(resultadoDeploy([{ state: "waiting", created_at: "2026-11-08T19:30:00Z" }]).estado, "incompleto");
  });
});

describe("analizarProduccion", () => {
  test("separa releases, ensayos y deploys fallidos, sin fallas", () => {
    const a = analizarProduccion([
      deploy("v0.5.0-rc.1", "2026-11-08T18:40:00Z"),
      deploy("v0.5.0", "2026-11-08T19:40:00Z"),
      deploy("v0.6.0", "2026-11-24T16:00:00Z", "fallido"),
      deploy("v0.6.0", "2026-11-24T17:00:00Z"),
    ]);
    assert.deepEqual(a.releases.map((r) => r.tag), ["v0.5.0", "v0.6.0"]);
    assert.equal(a.ensayos.length, 1);
    assert.equal(a.deploysFallidos.length, 1);
    assert.ok(a.releases.every((r) => !r.falla));
  });

  test("un release redesplegado cuenta una sola vez", () => {
    const a = analizarProduccion([
      deploy("v0.5.0", "2026-11-08T19:40:00Z"),
      deploy("v0.5.0", "2026-11-09T10:00:00Z"),
    ]);
    assert.equal(a.releases.length, 1);
  });

  test("un rollback después del release lo marca como falla, con recuperación", () => {
    const a = analizarProduccion([
      deploy("v0.5.0", "2026-11-08T19:40:00Z"),
      deploy("v0.6.0", "2026-11-24T17:00:00Z"),
      deploy("main", "2026-11-24T20:00:00Z"),
    ]);
    const [primero, segundo] = a.releases;
    assert.equal(primero.falla, false);
    assert.equal(segundo.falla, true);
    assert.equal(segundo.recuperacionHoras, 3);
    assert.match(segundo.motivo, /rollback/);
  });

  test("un hotfix marca como falla al release anterior", () => {
    const a = analizarProduccion([
      deploy("v0.6.0", "2026-11-24T17:00:00Z"),
      deploy("v0.6.1", "2026-11-25T11:00:00Z"),
    ]);
    assert.equal(a.releases[0].falla, true);
    assert.equal(a.releases[0].recuperacionHoras, 18);
    assert.equal(a.releases[0].motivo, "hotfix v0.6.1");
    assert.equal(a.releases[1].falla, false);
  });
});

describe("estadística y lead time", () => {
  test("percentil con interpolación", () => {
    assert.equal(percentil([], 0.5), null);
    assert.equal(percentil([5], 0.85), 5);
    assert.equal(percentil([1, 2, 3, 4], 0.5), 2.5);
    assert.equal(percentil([10, 20, 30, 40, 50], 0.85), 44);
  });

  test("lead time de un PR: total, revisión y release en horas", () => {
    const [lt] = leadTimePrs(
      [{ numero: 550, primerCommit: d("2026-11-20T10:00:00Z"), creado: d("2026-11-21T10:00:00Z"), mergeado: d("2026-11-22T10:00:00Z") }],
      d("2026-11-24T10:00:00Z"),
    );
    assert.deepEqual(lt, { numero: 550, total: 96, revision: 24, release: 48 });
  });

  test("PR de los mensajes de merge, sin repetir", () => {
    const commits = [
      { commit: { message: "Merge pull request #547 from VED/docs/BL-217" } },
      { commit: { message: "docs(BL-217): contingencia en render" } },
      { commit: { message: "Merge pull request #546 from VED/ci/BL-242" } },
      { commit: { message: "Merge pull request #547 from VED/docs/BL-217" } },
      { commit: { message: "Merge branch 'develop' into feat/x" } },
    ];
    assert.deepEqual(prsDeCommits(commits), [546, 547]);
  });

  test("solo cuentan los PR mergeados a develop que no son back-merge", () => {
    assert.equal(esPrDeCambio({ merged_at: "x", base: { ref: "develop" }, head: { ref: "feat/a" } }), true);
    assert.equal(esPrDeCambio({ merged_at: "x", base: { ref: "main" }, head: { ref: "develop" } }), false);
    assert.equal(esPrDeCambio({ merged_at: "x", base: { ref: "develop" }, head: { ref: "main" } }), false);
    assert.equal(esPrDeCambio({ merged_at: null, base: { ref: "develop" }, head: { ref: "feat/a" } }), false);
  });
});

describe("sprints y semanas", () => {
  test("un release del domingo cuenta para el sprint que terminó el viernes", () => {
    assert.equal(sprintDe(d("2026-11-08T19:40:00Z"), SPRINTS), "S7");
    assert.equal(sprintDe(d("2026-11-24T17:00:00Z"), SPRINTS), "Cierre");
    assert.equal(sprintDe(d("2026-12-02T12:00:00Z"), SPRINTS), "Después de la entrega");
  });

  test("hora de Uruguay: el 09/11 a las 01:00 UTC todavía es domingo 08", () => {
    assert.equal(sprintDe(d("2026-11-09T01:00:00Z"), SPRINTS), "S7");
  });

  test("frecuencia desde el sprint del primer release hasta hoy", () => {
    const releases = [{ desplegado: d("2026-11-08T19:40:00Z") }, { desplegado: d("2026-11-24T17:00:00Z") }];
    assert.deepEqual(frecuenciaPorSprint(releases, SPRINTS, d("2026-11-25T12:00:00Z")), [
      { sprint: "S7", releases: 1 },
      { sprint: "S8", releases: 0 },
      { sprint: "Cierre", releases: 1 },
    ]);
  });

  test("deploys por semana, de lunes a domingo", () => {
    const bins = porSemana(
      [d("2026-11-16T12:00:00Z"), d("2026-11-22T12:00:00Z"), d("2026-11-23T12:00:00Z")],
      d("2026-11-24T12:00:00Z"),
      2,
    );
    assert.deepEqual(bins, [
      { semana: "2026-11-16", cantidad: 2 },
      { semana: "2026-11-23", cantidad: 1 },
    ]);
  });
});

describe("resumen y semáforo", () => {
  test("el sprint actual no entra en el promedio de frecuencia", () => {
    const r = resumenDora({
      releases: [{ falla: false }, { falla: true, recuperacionHoras: 3 }],
      frecuencia: [
        { sprint: "S7", releases: 1 },
        { sprint: "S8", releases: 0 },
        { sprint: "Cierre", releases: 1 },
      ],
      leadTimes: [{ prs: [{ total: 48 }, { total: 96 }] }],
    });
    assert.equal(r.releasesPorSprint, 0.5);
    assert.equal(r.tasaFallas, 0.5);
    assert.equal(r.leadTimeMedianaDias, 3);
    assert.equal(r.recuperacionMedianaHoras, 3);
  });

  test("semáforo por sentido de la meta y sin datos", () => {
    assert.equal(semaforo(1, 1, "min"), "🟢");
    assert.equal(semaforo(0.5, 1, "min"), "🔴");
    assert.equal(semaforo(3, 14, "max"), "🟢");
    assert.equal(semaforo(null, 14, "max"), "⚪");
  });

  test("tasa de fallas: 15 % exacto no cumple la meta de menos de 15 %", () => {
    const md = renderResumen(
      { releases: 20, releasesPorSprint: 1, leadTimeMedianaDias: 2, leadTimeP85Dias: 3, prsMedidos: 5, fallidos: 3, tasaFallas: 0.15, recuperacionMedianaHoras: 2 },
      "24/11/2026",
    );
    assert.match(md, /Tasa de fallas en cambios \| 15 % \(3 de 20\) \| < 15 % \| 🔴/);
  });
});

describe("markdown", () => {
  test("el primer release figura como línea base del lead time", () => {
    const analisis = analizarProduccion([deploy("v0.5.0", "2026-11-08T19:40:00Z", "exitoso", "9817433abc")]);
    const md = renderReleases(analisis, [{ tag: "v0.5.0", primero: true, prs: [] }]);
    assert.match(md, /`v0\.5\.0` \| 08\/11 \| `9817433` \| Línea base/);
    assert.match(renderLeadTime([{ tag: "v0.5.0", primero: true, prs: [] }]), /segundo release/);
  });

  test("sin deploys ni releases, mensajes en lugar de tablas vacías", () => {
    assert.match(renderReleases(analizarProduccion([]), []), /Todavía no hay deploys/);
    assert.match(renderFrecuencia([]), /Todavía no hay releases/);
  });

  test("el gráfico de frecuencia es un xychart con un sprint por barra", () => {
    const md = renderFrecuencia([{ sprint: "S7", releases: 1 }, { sprint: "S8", releases: 0 }]);
    assert.match(md, /x-axis \["S7", "S8"\]/);
    assert.match(md, /bar \[1, 0\]/);
  });

  test("reemplaza solo el bloque indicado y falla si no existe", () => {
    const plantilla = "a\n<!-- AUTO:x:start -->\nviejo\n<!-- AUTO:x:end -->\nb";
    assert.equal(reemplazarBloque(plantilla, "x", "nuevo"), "a\n<!-- AUTO:x:start -->\n\nnuevo\n\n<!-- AUTO:x:end -->\nb");
    assert.throws(() => reemplazarBloque(plantilla, "y", "nuevo"), /AUTO:y/);
  });
});
