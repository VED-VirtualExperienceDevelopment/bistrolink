// BL-599: tests del aviso de E2E que empiezan a fallar en develop.
// No mandan correos ni llaman a GitHub:
//   node --test scripts/dashboards/aviso-e2e.test.mjs

import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  cambiosDelRango,
  correosPorUsuario,
  cuerpoCorreo,
  destinatarios,
  fallosNuevos,
  leerCarpeta,
  leerJunit,
  main,
  mencionar,
  repartirDestinatarios,
  urlNuevoIssue,
} from "./aviso-e2e.mjs";

// Como lo escribe el reporter junit de Playwright: una <testsuite> por
// archivo y navegador, con el navegador en «hostname».
const junit = (proyecto, casos) => `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
<testsuite name="admin/stock.spec.ts" hostname="${proyecto}" tests="${casos.length}">
${casos
  .map(([nombre, estado]) =>
    estado === "pasa"
      ? `<testcase name="${nombre}" classname="admin/stock.spec.ts" time="1"/>`
      : estado === "salteado"
        ? `<testcase name="${nombre}" classname="x"><skipped/></testcase>`
        : `<testcase name="${nombre}" classname="x"><failure message="Expected: 200 &amp; más" type="FAILURE">detalle</failure></testcase>`,
  )
  .join("\n")}
</testsuite>
</testsuites>`;

const A = "BL-120 › [TC-E-101] stock bajo &amp; alerta";
const B = "BL-120 › [TC-E-102] reponer";
const C = "BL-120 › [TC-E-103] nuevo";

describe("leerJunit", () => {
  test("estado por navegador y nombre, con las entidades decodificadas", () => {
    const estados = leerJunit(
      junit("chromium", [
        [A, "pasa"],
        [B, "falla"],
        [C, "salteado"],
      ]),
    );
    assert.equal(
      estados.get("chromium › BL-120 › [TC-E-101] stock bajo & alerta"),
      "pasa",
    );
    assert.equal(estados.get(`chromium › ${B}`), "falla");
    assert.equal(estados.get(`chromium › ${C}`), "salteado");
  });
});

describe("leerCarpeta", () => {
  test("lee el junit.xml de cada subcarpeta y el de la carpeta misma", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "aviso-e2e-"));
    try {
      await fs.mkdir(path.join(tmp, "playwright-resultados-firefox"));
      await fs.writeFile(
        path.join(tmp, "playwright-resultados-firefox", "junit.xml"),
        junit("firefox", [[B, "pasa"]]),
      );
      await fs.writeFile(
        path.join(tmp, "junit.xml"),
        junit("chromium", [[B, "falla"]]),
      );
      await fs.mkdir(path.join(tmp, "sin-junit"));
      const { estados, archivos } = await leerCarpeta(tmp);
      assert.equal(archivos, 2);
      assert.equal(estados.get(`firefox › ${B}`), "pasa");
      assert.equal(estados.get(`chromium › ${B}`), "falla");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("fallosNuevos", () => {
  const estados = (pares) => new Map(pares);

  test("solo los que fallan ahora y antes pasaban, estaban salteados o no existían", () => {
    const antes = estados([
      ["chromium › t1", "pasa"],
      ["chromium › t2", "falla"],
      ["chromium › t3", "salteado"],
    ]);
    const ahora = estados([
      ["chromium › t1", "falla"],
      ["chromium › t2", "falla"],
      ["chromium › t3", "falla"],
      ["chromium › t4", "falla"],
      ["firefox › t2", "falla"],
      ["chromium › t5", "pasa"],
    ]);
    assert.deepEqual(fallosNuevos(ahora, antes), [
      { navegador: "chromium", test: "t1" },
      { navegador: "firefox", test: "t2" },
      { navegador: "chromium", test: "t3" },
      { navegador: "chromium", test: "t4" },
    ]);
  });

  test("si ya fallaba antes, no es nuevo", () => {
    const m = estados([["chromium › t1", "falla"]]);
    assert.deepEqual(fallosNuevos(m, m), []);
  });
});

describe("cambiosDelRango", () => {
  const respuestas = {
    "/compare/aaa...bbb": {
      commits: [
        { sha: "c1", author: { login: "x" } },
        { sha: "c2", author: { login: "dependabot[bot]" } },
        { sha: "c3", author: { login: "eric" } },
      ],
    },
    "/commits/c1/pulls": [
      {
        number: 10,
        title: "feat: uno",
        user: { login: "daiana" },
        merged_at: "2026-11-21",
      },
    ],
    "/commits/c2/pulls": [],
    "/commits/c3/pulls": [],
    "/commits/bbb": { sha: "bbb", author: { login: "veronica" } },
    "/commits/bbb/pulls": [
      {
        number: 11,
        title: "fix: dos",
        user: { login: "veronica" },
        merged_at: "2026-11-21",
      },
    ],
  };
  const fetchFalso = async (url, { headers }) => {
    assert.equal(headers.Authorization, "Bearer t");
    const ruta = url.replace("https://api.github.com/repos/o/r", "");
    return {
      ok: ruta in respuestas,
      status: 404,
      json: async () => respuestas[ruta],
    };
  };

  test("autores de los PR del rango; sin PR, el autor del commit; sin bots", async () => {
    const r = await cambiosDelRango({
      api: "https://api.github.com",
      repo: "o/r",
      base: "aaa",
      head: "bbb",
      token: "t",
      fetch: fetchFalso,
    });
    assert.deepEqual(r.autores, ["daiana", "eric"]);
    assert.deepEqual(r.prs, [
      { numero: 10, titulo: "feat: uno", autor: "daiana" },
    ]);
  });

  test("sin commit anterior, solo el commit de la corrida", async () => {
    const r = await cambiosDelRango({
      api: "https://api.github.com",
      repo: "o/r",
      base: null,
      head: "bbb",
      token: "t",
      fetch: fetchFalso,
    });
    assert.deepEqual(r.autores, ["veronica"]);
  });

  test("un error de la API corta el aviso", async () => {
    await assert.rejects(
      cambiosDelRango({
        api: "https://api.github.com",
        repo: "o/r",
        base: "zzz",
        head: "bbb",
        token: "t",
        fetch: fetchFalso,
      }),
      /GitHub respondió 404/,
    );
  });
});

describe("destinatarios", () => {
  test("los correos del equipo, sin vacíos ni repetidos", () => {
    assert.deepEqual(
      destinatarios(" a@ejemplo.com, ,b@ejemplo.com, A@ejemplo.com "),
      ["a@ejemplo.com", "b@ejemplo.com"],
    );
    assert.deepEqual(destinatarios(undefined), []);
  });
});

describe("correosPorUsuario", () => {
  test("usuario de GitHub sin mayúsculas y su correo; ignora lo incompleto", () => {
    const m = correosPorUsuario(
      " Daiana = d@ejemplo.com, eric=, =x@y, veronica=v@ejemplo.com ",
    );
    assert.deepEqual(
      [...m],
      [
        ["daiana", "d@ejemplo.com"],
        ["veronica", "v@ejemplo.com"],
      ],
    );
    assert.equal(correosPorUsuario(undefined).size, 0);
  });
});

describe("repartirDestinatarios", () => {
  const equipo = ["d@ejemplo.com", "e@ejemplo.com", "v@ejemplo.com"];
  const correos = correosPorUsuario("daiana=D@ejemplo.com,eric=e@ejemplo.com");

  test("para el autor y el resto del equipo en copia", () => {
    assert.deepEqual(
      repartirDestinatarios({ autores: ["Daiana"], equipo, correos }),
      {
        para: ["D@ejemplo.com"],
        copia: ["e@ejemplo.com", "v@ejemplo.com"],
        personal: true,
      },
    );
  });

  test("varios autores van todos en para", () => {
    const r = repartirDestinatarios({
      autores: ["daiana", "eric", "externo"],
      equipo,
      correos,
    });
    assert.deepEqual(r.para, ["D@ejemplo.com", "e@ejemplo.com"]);
    assert.deepEqual(r.copia, ["v@ejemplo.com"]);
  });

  test("sin el correo de ningún autor, va a todo el equipo sin copia", () => {
    assert.deepEqual(
      repartirDestinatarios({ autores: ["externo"], equipo, correos }),
      { para: equipo, copia: [], personal: false },
    );
    assert.deepEqual(
      repartirDestinatarios({ autores: [], equipo, correos: new Map() }).para,
      equipo,
    );
  });
});

describe("urlNuevoIssue", () => {
  test("plantilla de bug con entorno, PR y etiquetas de regresión", () => {
    const url = new URL(
      urlNuevoIssue({
        servidor: "https://github.com",
        repo: "o/r",
        prs: [{ numero: 550 }, { numero: 551 }],
      }),
    );
    assert.equal(url.pathname, "/o/r/issues/new");
    assert.equal(url.searchParams.get("template"), "bug.yml");
    assert.equal(url.searchParams.get("labels"), "bug,regresion");
    assert.equal(url.searchParams.get("entorno"), "Staging");
    assert.equal(url.searchParams.get("introducido"), "#550, #551");
  });

  test("sin PR no completa «introducido»", () => {
    const url = new URL(urlNuevoIssue({ repo: "o/r" }));
    assert.equal(url.origin, "https://github.com");
    assert.equal(url.searchParams.has("introducido"), false);
  });

  test("las opciones coinciden con la plantilla real", async () => {
    const plantilla = await fs.readFile(
      new URL("../../.github/ISSUE_TEMPLATE/bug.yml", import.meta.url),
      "utf-8",
    );
    for (const id of ["entorno", "introducido"])
      assert.match(plantilla, new RegExp(`id: ${id}\\b`));
    assert.match(plantilla, /- Staging$/m);
  });
});

describe("mencionar", () => {
  test("nombra a los autores con @", () => {
    assert.equal(mencionar([]), "");
    assert.equal(mencionar(["ana"]), "@ana");
    assert.equal(mencionar(["ana", "beto", "caro"]), "@ana, @beto y @caro");
  });
});

describe("cuerpoCorreo", () => {
  test("lista los tests, los cambios y los enlaces, y escapa el HTML", () => {
    const html = cuerpoCorreo({
      fallos: [{ navegador: "chromium", test: "<b>[TC-E-001]</b> login" }],
      prs: [{ numero: 10, titulo: "feat: uno", autor: "daiana" }],
      autores: ["daiana"],
      corrida: 1234,
      urlCorrida: "https://github.com/o/r/actions/runs/9",
      urlAllure: "https://o.github.io/r/allure/e2e/",
    });
    assert.ok(html.includes("&lt;b&gt;[TC-E-001]&lt;/b&gt; login"));
    assert.ok(html.includes("#10 feat: uno (daiana)"));
    assert.ok(html.includes("actions/runs/9"));
    assert.ok(html.includes("allure/e2e/"));
    assert.match(html, /Hola @daiana/);
    assert.match(html, /verificá los tests que fallan/);
  });

  test("sin autores ni PR, saluda al equipo y no falla", () => {
    const html = cuerpoCorreo({
      fallos: [{ navegador: "chromium", test: "login" }],
      corrida: 1,
      urlCorrida: "https://github.com/o/r/actions/runs/1",
    });
    assert.match(html, /Hola, equipo: en la corrida #1/);
    assert.match(html, /verifiquen los tests que fallan/);
    assert.doesNotMatch(html, /en copia/);
  });

  test("dirigido al autor: le habla de su PR y avisa que el equipo va en copia", () => {
    const html = cuerpoCorreo({
      fallos: [{ navegador: "chromium", test: "login" }],
      prs: [{ numero: 550, titulo: "fix: link de pago", autor: "daiana" }],
      autores: ["daiana"],
      personal: true,
      corrida: 2,
      urlCorrida: "https://github.com/o/r/actions/runs/2",
    });
    assert.match(html, /Hola @daiana: .*entró tu PR:/s);
    assert.match(html, /verificá los tests que fallan/);
    assert.match(html, /El resto del equipo recibe este aviso en copia/);
    assert.doesNotMatch(html, /Dónde reportarlo/);
  });

  test("con el enlace para reportar, también avisa de SECURITY.md", () => {
    const html = cuerpoCorreo({
      fallos: [{ navegador: "chromium", test: "login" }],
      prs: [{ numero: 550, titulo: "x" }],
      corrida: 4,
      urlCorrida: "https://github.com/o/r/actions/runs/4",
      urlIssue: urlNuevoIssue({ repo: "o/r", prs: [{ numero: 550 }] }),
      urlSeguridad: "https://github.com/o/r/blob/develop/SECURITY.md",
    });
    assert.match(html, /Dónde reportarlo/);
    assert.match(
      html,
      /issues\/new\?template=bug\.yml&amp;labels=bug%2Cregresion/,
    );
    assert.match(html, /SECURITY\.md/);
  });

  test("tiene la marca del correo de estado y no repite estilos sueltos", () => {
    const html = cuerpoCorreo({
      fallos: [{ navegador: "chromium", test: "login" }],
      corrida: 3,
      urlCorrida: "https://github.com/o/r/actions/runs/3",
    });
    assert.match(html, /background-color:#381e72/);
    assert.match(html, /⚠️ BistroLink — E2E que empezaron a fallar/);
    assert.match(html, /Plus Jakarta Sans/);
    assert.match(html, /color:#4f378a; text-decoration:underline;/);
  });
});

describe("main", () => {
  async function preparar(hoy, antes) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "aviso-e2e-"));
    for (const [carpeta, casos] of [
      ["actual", hoy],
      ["anterior", antes],
    ]) {
      if (!casos) continue;
      await fs.mkdir(
        path.join(tmp, carpeta, "playwright-resultados-chromium"),
        { recursive: true },
      );
      await fs.writeFile(
        path.join(tmp, carpeta, "playwright-resultados-chromium", "junit.xml"),
        junit("chromium", casos),
      );
    }
    const env = {
      GITHUB_OUTPUT: path.join(tmp, "output"),
      GITHUB_STEP_SUMMARY: path.join(tmp, "summary"),
      RUNNER_TEMP: tmp,
    };
    return { tmp, env };
  }

  test("sin fallos nuevos no se envía y no se llama a GitHub", async () => {
    const { tmp, env } = await preparar([[B, "falla"]], [[B, "falla"]]);
    try {
      await main(
        [
          "--actual",
          path.join(tmp, "actual"),
          "--anterior",
          path.join(tmp, "anterior"),
        ],
        env,
      );
      assert.equal(
        await fs.readFile(env.GITHUB_OUTPUT, "utf-8"),
        "enviar=false\n",
      );
      assert.match(
        await fs.readFile(env.GITHUB_STEP_SUMMARY, "utf-8"),
        /Ningún E2E empezó a fallar/,
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("con fallos nuevos: para el autor del PR y el equipo en copia", async () => {
    const { tmp, env } = await preparar([[A, "falla"]], [[A, "pasa"]]);
    const respuestas = {
      "/compare/aaa...bbb": { commits: [{ sha: "c1" }] },
      "/commits/c1/pulls": [
        {
          number: 550,
          title: "fix: link de pago",
          user: { login: "daiana" },
          merged_at: "2026-11-22",
        },
      ],
    };
    const fetchFalso = async (url) => {
      const ruta = url.replace("https://api.github.com/repos/o/r", "");
      return {
        ok: ruta in respuestas,
        status: 404,
        json: async () => respuestas[ruta],
      };
    };
    try {
      await main(
        [
          "--actual",
          path.join(tmp, "actual"),
          "--anterior",
          path.join(tmp, "anterior"),
        ],
        {
          ...env,
          GITHUB_REPOSITORY: "o/r",
          GITHUB_SHA: "bbb",
          SHA_ANTERIOR: "aaa",
          GITHUB_TOKEN: "t",
          EQUIPO_CORREOS: "d@ejemplo.com,b@ejemplo.com,c@ejemplo.com",
          EQUIPO_GITHUB: "daiana=d@ejemplo.com,beto=b@ejemplo.com",
          MAIL_USERNAME: "ci@ejemplo.com",
          GITHUB_RUN_NUMBER: "7",
        },
        fetchFalso,
      );
      const salida = await fs.readFile(env.GITHUB_OUTPUT, "utf-8");
      assert.match(salida, /^enviar=true$/m);
      assert.match(salida, /^to=d@ejemplo\.com$/m);
      assert.match(salida, /^cc=b@ejemplo\.com,c@ejemplo\.com$/m);
      assert.match(salida, /^subject=.*1 E2E empezaron a fallar.*@daiana$/m);
      const html = await fs.readFile(path.join(tmp, "aviso-e2e.html"), "utf-8");
      assert.match(html, /Hola @daiana/);
      assert.match(html, /entró tu PR/);
      assert.match(html, /o\/r\/issues\/new\?template=bug\.yml/);
      assert.match(html, /introducido=%23550/);
      assert.match(html, /#550 fix: link de pago \(daiana\)/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test("sin corrida anterior no se envía", async () => {
    const { tmp, env } = await preparar([[B, "falla"]], null);
    try {
      await main(["--actual", path.join(tmp, "actual")], env);
      assert.equal(
        await fs.readFile(env.GITHUB_OUTPUT, "utf-8"),
        "enviar=false\n",
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
