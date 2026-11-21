// BL-597: tests de los datos que completan el reporte Allure de los E2E.
// Sin dependencias:
//   node --test scripts/dashboards/datos-allure.test.mjs

import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  AREA_GENERAL,
  CATEGORIAS,
  agregarFuncionalidad,
  completarCarpeta,
  datosEntorno,
  ejecutor,
  funcionalidad,
  nombreLegible,
  propiedadesEntorno,
} from "./datos-allure.mjs";

// Como lo escribe allure-playwright: parentSuite = proyecto, suite = archivo
// relativo a e2e/, subSuite = los test.describe() separados por « > ».
const resultado = (suite, subSuite, extra = []) => ({
  name: "un test",
  status: "passed",
  labels: [
    { name: "parentSuite", value: "chromium" },
    { name: "suite", value: suite },
    ...(subSuite ? [{ name: "subSuite", value: subSuite }] : []),
    ...extra,
  ],
});

const ENV_CI = {
  ALLURE_ENTORNO: "staging",
  ALLURE_WEB_URL: "https://web.ejemplo.com",
  ALLURE_API_URL: "https://api.ejemplo.com",
  ALLURE_VERSION: "v1.2.3-dev.4",
  ALLURE_REPORT_NAME: "BistroLink — E2E v1.2.3-dev.4",
  ALLURE_REPORT_URL: "https://ejemplo.github.io/bistrolink/allure/e2e/",
  GITHUB_SHA: "0123456789abcdef",
  GITHUB_REF_NAME: "develop",
  GITHUB_RUN_NUMBER: "1234",
  GITHUB_RUN_ID: "987654321",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "org/repo",
};

describe("nombreLegible", () => {
  test("saca la extensión del spec y separa las palabras", () => {
    assert.equal(
      nombreLegible("admin/gestion-usuarios.spec.ts"),
      "Gestion usuarios",
    );
    assert.equal(
      nombreLegible("pedido-listo-entregado.spec.ts"),
      "Pedido listo entregado",
    );
  });
});

describe("funcionalidad", () => {
  test("el área sale de la carpeta y la historia del primer describe", () => {
    assert.deepEqual(
      funcionalidad(
        resultado(
          "admin/gestion-usuarios.spec.ts",
          "BL-357 · Gestión de usuarios > en el celular",
        ),
      ),
      {
        feature: "Administración y mozo",
        story: "BL-357 · Gestión de usuarios",
      },
    );
  });

  test("sin describe, la historia es el nombre del archivo", () => {
    assert.deepEqual(funcionalidad(resultado("kds/monitor-cocina.spec.ts")), {
      feature: "Cocina (KDS)",
      story: "Monitor cocina",
    });
  });

  test("un spec en la raíz de e2e va al área general", () => {
    assert.equal(
      funcionalidad(resultado("pedido-listo-entregado.spec.ts")).feature,
      AREA_GENERAL,
    );
  });

  test("una carpeta nueva usa su nombre legible", () => {
    assert.equal(
      funcionalidad(resultado("reportes/ventas.spec.ts")).feature,
      "Reportes",
    );
  });
});

describe("agregarFuncionalidad", () => {
  test("agrega feature y story si faltan", () => {
    const r = resultado("comensal/pago.spec.ts", "BL-311: Pago del comensal");
    assert.equal(agregarFuncionalidad(r), true);
    assert.ok(
      r.labels.some((l) => l.name === "feature" && l.value === "Comensal"),
    );
    assert.ok(
      r.labels.some(
        (l) => l.name === "story" && l.value === "BL-311: Pago del comensal",
      ),
    );
  });

  test("respeta las que puso el spec y no duplica", () => {
    const r = resultado("comensal/pago.spec.ts", null, [
      { name: "feature", value: "Pagos" },
      { name: "story", value: "Tarjeta" },
    ]);
    assert.equal(agregarFuncionalidad(r), false);
    assert.equal(r.labels.filter((l) => l.name === "feature").length, 1);
  });
});

describe("propiedadesEntorno", () => {
  test("una línea por dato definido, sin los vacíos", () => {
    const texto = propiedadesEntorno({
      Entorno: "staging",
      Rama: "",
      Version: undefined,
    });
    assert.equal(texto, "Entorno=staging\n");
  });

  test("escapa la clave y no deja saltos de línea en el valor", () => {
    assert.equal(
      propiedadesEntorno({ "Clave rara": "a\nb" }),
      "Clave\\ rara=a b\n",
    );
  });
});

describe("datosEntorno", () => {
  test("commit corto, corrida con # y navegadores en lista", () => {
    const datos = datosEntorno(ENV_CI, ["chromium", "firefox"]);
    assert.equal(datos.Commit, "0123456");
    assert.equal(datos.Corrida, "#1234");
    assert.equal(datos.Navegadores, "chromium, firefox");
    assert.equal(datos.Entorno, "staging");
  });

  test("solo usa datos públicos: ninguna variable con credenciales", () => {
    const datos = datosEntorno({ ...ENV_CI, TEST_ADMIN_PASSWORD: "no-va" }, []);
    assert.ok(!JSON.stringify(datos).includes("no-va"));
  });
});

describe("ejecutor", () => {
  test("arma el enlace a la corrida de GitHub Actions", () => {
    const e = ejecutor(ENV_CI);
    assert.equal(e.type, "github");
    assert.equal(e.buildOrder, 1234);
    assert.equal(
      e.buildUrl,
      "https://github.com/org/repo/actions/runs/987654321",
    );
    assert.equal(e.reportUrl, ENV_CI.ALLURE_REPORT_URL);
  });

  test("fuera del CI no hay ejecutor", () => {
    assert.equal(ejecutor({}), null);
  });
});

describe("CATEGORIAS", () => {
  // Misma regla que Allure 3: RegExp con la bandera «s» y test().
  const primera = (status, mensaje, flaky = false) =>
    CATEGORIAS.find(
      (c) =>
        (!c.matchedStatuses || c.matchedStatuses.includes(status)) &&
        (!c.messageRegex || new RegExp(c.messageRegex, "s").test(mensaje)) &&
        (c.flaky ?? flaky) === flaky,
    )?.name;

  test("cada fallo cae en su categoría", () => {
    assert.match(
      primera("failed", "expect(page).toHaveScreenshot() failed"),
      /visual/,
    );
    assert.match(primera("failed", "Expected: 200\nReceived: 403"), /permisos/);
    assert.match(primera("failed", "Expected: 200\nReceived: 502"), /5xx/);
    assert.match(
      primera("broken", "locator.click: Timeout 30000ms exceeded."),
      /espera/,
    );
    assert.match(
      primera("failed", "expect(locator).toHaveText(expected)"),
      /producto/,
    );
    assert.match(primera("broken", "TypeError: x is undefined"), /test/);
    assert.match(primera("passed", "", true), /Inestables/);
  });

  test("un timeout de 5000 ms no cuenta como error 5xx", () => {
    assert.match(primera("broken", "Timeout 5000ms exceeded."), /espera/);
  });
});

describe("completarCarpeta", () => {
  test("escribe los tres archivos y etiqueta los resultados", async () => {
    const carpeta = await fs.mkdtemp(path.join(os.tmpdir(), "allure-datos-"));
    try {
      await fs.writeFile(
        path.join(carpeta, "a-result.json"),
        JSON.stringify(resultado("admin/stock.spec.ts", "BL-120: stock")),
      );
      const b = resultado("sesion/ingreso.spec.ts");
      b.labels[0].value = "firefox";
      await fs.writeFile(
        path.join(carpeta, "b-result.json"),
        JSON.stringify(b),
      );

      const r = await completarCarpeta(carpeta, ENV_CI);
      assert.deepEqual(r, {
        resultados: 2,
        etiquetados: 2,
        navegadores: ["chromium", "firefox"],
        ejecutor: true,
      });

      const entorno = await fs.readFile(
        path.join(carpeta, "environment.properties"),
        "utf-8",
      );
      assert.match(entorno, /^Entorno=staging$/m);
      assert.match(entorno, /^Navegadores=chromium, firefox$/m);
      const categorias = JSON.parse(
        await fs.readFile(path.join(carpeta, "categories.json"), "utf-8"),
      );
      assert.equal(categorias.length, CATEGORIAS.length);
      const exec = JSON.parse(
        await fs.readFile(path.join(carpeta, "executor.json"), "utf-8"),
      );
      assert.equal(exec.buildName, "CI/CD BistroLink #1234");

      const a = JSON.parse(
        await fs.readFile(path.join(carpeta, "a-result.json"), "utf-8"),
      );
      assert.ok(
        a.labels.some(
          (l) => l.name === "feature" && l.value === "Administración y mozo",
        ),
      );
    } finally {
      await fs.rm(carpeta, { recursive: true, force: true });
    }
  });

  test("sin resultados, falla", async () => {
    const carpeta = await fs.mkdtemp(path.join(os.tmpdir(), "allure-datos-"));
    try {
      await assert.rejects(
        completarCarpeta(carpeta, ENV_CI),
        /No hay resultados/,
      );
    } finally {
      await fs.rm(carpeta, { recursive: true, force: true });
    }
  });
});
