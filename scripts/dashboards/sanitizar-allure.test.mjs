// BL-487: tests de la preparación de los resultados de Allure para publicar.
// Sin dependencias:
//   node --test scripts/dashboards/sanitizar-allure.test.mjs

import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  OCULTO,
  adjuntoPublicable,
  ocultarCredenciales,
  ocultarTexto,
  sanitizarCarpeta,
  sanitizarJunit,
  sanitizarObjeto,
} from "./sanitizar-allure.mjs";

const CLAVE = "clave-de-prueba-123";
const TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.firma-de-prueba";
// Como lo escribe Playwright cuando falla un pedido a la API.
const CALL_LOG = `apiRequestContext.get: Timeout 30000ms exceeded.
Call log:
  - → GET https://api.ejemplo.com/plataforma/establecimientos
  -   user-agent: Playwright/1.63.0
  -   authorization: Bearer ${TOKEN}
  -   cookie: sesion=${CLAVE}`;

function resultado() {
  return {
    uuid: "r1",
    name: "[TC-E-001] Ingreso: el mozo entra con usuario y contraseña",
    status: "failed",
    statusDetails: {
      message: CALL_LOG,
      trace: `Error: ${CALL_LOG}\n    at prueba.spec.ts:10:5`,
    },
    parameters: [{ name: "Project", value: "chromium" }],
    attachments: [
      { name: "screenshot", source: "a-attachment.png", type: "image/png" },
      {
        name: "trace",
        source: "b-attachment.zip",
        type: "application/vnd.allure.playwright-trace",
      },
    ],
    steps: [
      {
        name: "Before Hooks",
        steps: [
          {
            name: `Fill "${CLAVE}"`,
            parameters: [{ name: "value", value: CLAVE }],
            steps: [],
          },
          { name: 'Click getByRole("button")', steps: [] },
        ],
      },
      {
        name: "Ingresar",
        statusDetails: { message: `"authorization":"Bearer ${TOKEN}"` },
        attachments: [
          {
            name: "error-context",
            source: "c-attachment.md",
            type: "text/markdown",
          },
        ],
        steps: [
          { name: `Type "${CLAVE}"` },
          { name: `Press sequentially "${CLAVE}"` },
        ],
      },
    ],
  };
}

describe("ocultarTexto", () => {
  test("oculta el texto de los pasos que escriben en un campo", () => {
    assert.equal(ocultarTexto(`Fill "${CLAVE}"`), `Fill "${OCULTO}"`);
    assert.equal(
      ocultarTexto(`Fill "${CLAVE}" locator('input')`),
      `Fill "${OCULTO}"`,
    );
    assert.equal(ocultarTexto(`Type "${CLAVE}"`), `Type "${OCULTO}"`);
    assert.equal(
      ocultarTexto(`Press sequentially "${CLAVE}"`),
      `Press sequentially "${OCULTO}"`,
    );
  });

  test("también con comillas dentro del texto", () => {
    assert.equal(ocultarTexto('Fill "a"b" c"'), `Fill "${OCULTO}"`);
  });

  test("no toca los demás pasos", () => {
    for (const nombre of [
      'Click getByRole("button")',
      'Expect "toHaveText"',
      "Filling the form",
      "Ingresar",
    ]) {
      assert.equal(ocultarTexto(nombre), nombre);
    }
  });
});

describe("ocultarCredenciales", () => {
  test("oculta los encabezados con credenciales del call log", () => {
    const limpio = ocultarCredenciales(CALL_LOG);
    assert.doesNotMatch(limpio, new RegExp(CLAVE));
    assert.doesNotMatch(limpio, /eyJhbGci/);
    assert.match(limpio, new RegExp(`authorization: ${OCULTO}`));
    assert.match(limpio, new RegExp(`cookie: ${OCULTO}`));
    // El resto del mensaje se conserva.
    assert.match(
      limpio,
      /GET https:\/\/api\.ejemplo\.com\/plataforma\/establecimientos/,
    );
    assert.match(limpio, /user-agent: Playwright/);
  });

  test("también en JSON y con un token suelto", () => {
    assert.equal(
      ocultarCredenciales(`{"authorization":"Bearer ${TOKEN}"}`),
      `{"authorization":"${OCULTO}"}`,
    );
    assert.equal(
      ocultarCredenciales(`token Bearer ${TOKEN} vencido`),
      `token Bearer ${OCULTO} vencido`,
    );
  });

  test("dentro de un junit.xml no se come el cierre de la etiqueta", () => {
    const xml = `<failure message="authorization: Bearer ${TOKEN}">x</failure>`;
    assert.equal(
      ocultarCredenciales(xml),
      `<failure message="authorization: ${OCULTO}">x</failure>`,
    );
  });

  test("no toca el texto sin credenciales", () => {
    for (const texto of [
      "Expected: 3\nReceived: 2",
      "Bearer token",
      undefined,
    ]) {
      assert.equal(ocultarCredenciales(texto), texto);
    }
  });
});

describe("adjuntoPublicable", () => {
  test("solo las imágenes", () => {
    assert.equal(adjuntoPublicable({ type: "image/png" }), true);
    assert.equal(
      adjuntoPublicable({ type: "application/vnd.allure.playwright-trace" }),
      false,
    );
    assert.equal(adjuntoPublicable({ type: "text/markdown" }), false);
    assert.equal(adjuntoPublicable({ type: "video/webm" }), false);
    assert.equal(adjuntoPublicable({}), false);
  });
});

describe("sanitizarObjeto", () => {
  test("no queda la contraseña ni el token en ninguna parte del resultado", () => {
    const r = resultado();
    sanitizarObjeto(r);
    const json = JSON.stringify(r);
    assert.doesNotMatch(json, new RegExp(CLAVE));
    assert.doesNotMatch(json, /eyJhbGci/);
  });

  test("deja solo las capturas y devuelve los adjuntos quitados", () => {
    const r = resultado();
    const quitados = sanitizarObjeto(r);
    assert.deepEqual(
      r.attachments.map((a) => a.source),
      ["a-attachment.png"],
    );
    assert.deepEqual(r.steps[1].attachments, []);
    assert.deepEqual(quitados.sort(), ["b-attachment.zip", "c-attachment.md"]);
  });

  test("conserva el proyecto y los pasos que no escriben", () => {
    const r = resultado();
    sanitizarObjeto(r);
    assert.deepEqual(r.parameters, [{ name: "Project", value: "chromium" }]);
    assert.equal(r.steps[0].steps[1].name, 'Click getByRole("button")');
    assert.deepEqual(r.steps[0].steps[0].parameters, []);
  });

  test("también sanitiza los hooks de un contenedor", () => {
    const contenedor = {
      befores: [{ name: "auth", steps: [{ name: `Fill "${CLAVE}"` }] }],
    };
    sanitizarObjeto(contenedor);
    assert.equal(contenedor.befores[0].steps[0].name, `Fill "${OCULTO}"`);
  });
});

describe("sanitizarCarpeta", () => {
  async function carpetaDePrueba() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "allure-"));
    await fs.writeFile(
      path.join(dir, "r1-result.json"),
      JSON.stringify(resultado()),
    );
    await fs.writeFile(
      path.join(dir, "k1-container.json"),
      JSON.stringify({
        befores: [{ name: `Fill "${CLAVE}"`, attachments: [] }],
      }),
    );
    for (const archivo of [
      "a-attachment.png",
      "b-attachment.zip",
      "c-attachment.md",
    ]) {
      await fs.writeFile(path.join(dir, archivo), CLAVE);
    }
    return dir;
  }

  test("reescribe los resultados y borra los adjuntos no publicables", async () => {
    const dir = await carpetaDePrueba();
    try {
      const resumen = await sanitizarCarpeta(dir);
      // 4 pasos que escriben, y en los errores: 2 encabezados del mensaje,
      // 2 de la traza y 1 del paso «Ingresar».
      assert.deepEqual(resumen, {
        resultados: 1,
        adjuntosQuitados: 2,
        valoresOcultos: 9,
      });
      assert.deepEqual((await fs.readdir(dir)).sort(), [
        "a-attachment.png",
        "k1-container.json",
        "r1-result.json",
      ]);
      for (const archivo of ["r1-result.json", "k1-container.json"]) {
        assert.doesNotMatch(
          await fs.readFile(path.join(dir, archivo), "utf-8"),
          new RegExp(CLAVE),
        );
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("sanitizarlo dos veces no cambia nada", async () => {
    const dir = await carpetaDePrueba();
    try {
      await sanitizarCarpeta(dir);
      const primera = await fs.readFile(
        path.join(dir, "r1-result.json"),
        "utf-8",
      );
      await sanitizarCarpeta(dir);
      assert.equal(
        await fs.readFile(path.join(dir, "r1-result.json"), "utf-8"),
        primera,
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("falla si la carpeta no tiene resultados", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "allure-"));
    try {
      await assert.rejects(
        sanitizarCarpeta(dir),
        /No hay resultados de Allure/,
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("sanitizarJunit", () => {
  test("oculta las credenciales del junit.xml y conserva el resto", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "junit-"));
    const ruta = path.join(dir, "junit.xml");
    try {
      await fs.writeFile(
        ruta,
        `<testsuites><testsuite><testcase name="[TC-E-001] prueba"><failure message="falló">${CALL_LOG}</failure></testcase></testsuite></testsuites>`,
      );
      const { valoresOcultos } = await sanitizarJunit(ruta);
      const xml = await fs.readFile(ruta, "utf-8");
      assert.equal(valoresOcultos, 2);
      assert.doesNotMatch(xml, /eyJhbGci/);
      assert.doesNotMatch(xml, new RegExp(CLAVE));
      assert.match(xml, /\[TC-E-001\] prueba/);
      assert.match(xml, /<\/failure><\/testcase>/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
