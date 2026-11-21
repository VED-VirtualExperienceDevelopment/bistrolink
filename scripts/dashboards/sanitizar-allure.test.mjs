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
  ocultarTexto,
  sanitizarCarpeta,
  sanitizarObjeto,
} from "./sanitizar-allure.mjs";

const CLAVE = "clave-de-prueba-123";

function resultado() {
  return {
    uuid: "r1",
    name: "[TC-E-001] Ingreso: el mozo entra con usuario y contraseña",
    status: "failed",
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
  test("no queda la contraseña en ninguna parte del resultado", () => {
    const r = resultado();
    sanitizarObjeto(r);
    assert.doesNotMatch(JSON.stringify(r), new RegExp(CLAVE));
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
      assert.deepEqual(resumen, {
        resultados: 1,
        adjuntosQuitados: 2,
        pasosOcultos: 4,
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
