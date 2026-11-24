// BL-218: tests del resumen del informe de OWASP ZAP. Sin dependencias:
//   node --test scripts/dast/resumen-zap.test.mjs

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  AVISO_SIN_DETALLE,
  anotaciones,
  falla,
  leerFueraDeAlcance,
  leerReglas,
  renderMarkdown,
  resumirInforme,
} from "./resumen-zap.mjs";

// Forma del JSON de ZAP (-J): riskcode y confidence llegan como texto.
const informe = {
  site: [
    {
      "@name": "https://bistrolink-web-staging.up.railway.app",
      alerts: [
        {
          pluginid: "10038",
          name: "Content Security Policy (CSP) Header Not Set",
          riskcode: "2",
          confidence: "3",
          count: "4",
          cweid: "693",
          instances: [
            {
              uri: "https://bistrolink-web-staging.up.railway.app/login",
              method: "GET",
            },
          ],
        },
        {
          pluginid: "40012",
          name: "Cross Site Scripting (Reflected)",
          riskcode: "3",
          confidence: "2",
          count: "1",
          cweid: "79",
          instances: [
            {
              uri: "https://bistrolink-web-staging.up.railway.app/m?q=x",
              method: "GET",
            },
          ],
        },
        {
          pluginid: "10096",
          name: "Timestamp Disclosure - Unix",
          riskcode: "0",
          confidence: "1",
          count: "2",
          cweid: "-1",
          instances: [],
        },
        {
          pluginid: "10049",
          name: "Storable and Cacheable Content",
          riskcode: "1",
          confidence: "2",
          count: "3",
          cweid: "524",
          instances: [
            {
              uri: "https://bistrolink-web-staging.up.railway.app/",
              method: "GET",
            },
          ],
        },
      ],
    },
  ],
};

describe("leerReglas", () => {
  test("lee el formato TSV de ZAP y saltea comentarios y líneas vacías", () => {
    const reglas = leerReglas(
      "# comentario\n\n10096\tIGNORE\tTimestamps de Next.js, no son datos\n10038\tWARN\n",
    );
    assert.equal(reglas.size, 2);
    assert.deepEqual(reglas.get("10096"), {
      accion: "IGNORE",
      motivo: "Timestamps de Next.js, no son datos",
    });
    assert.equal(reglas.get("10038").accion, "WARN");
  });

  test("el archivo real del repositorio se puede leer y cada IGNORE tiene motivo", () => {
    const reglas = leerReglas(
      readFileSync(new URL("./reglas-zap.tsv", import.meta.url), "utf-8"),
    );
    for (const [id, r] of reglas) {
      assert.ok(
        ["IGNORE", "INFO", "WARN", "FAIL"].includes(r.accion),
        `acción inválida en ${id}`,
      );
      if (r.accion === "IGNORE")
        assert.ok(r.motivo.length > 10, `la regla ${id} se ignora sin motivo`);
    }
  });
});

describe("resumirInforme", () => {
  test("ordena por riesgo y cuenta por nivel", () => {
    const r = resumirInforme(informe);
    assert.deepEqual(
      r.alertas.map((a) => a.id),
      ["40012", "10038", "10049", "10096"],
    );
    assert.deepEqual(r.porRiesgo, [1, 1, 1, 1]);
    assert.equal(
      r.alertas[1].ejemplo,
      "GET https://bistrolink-web-staging.up.railway.app/login",
    );
    assert.equal(r.alertas[3].cwe, null);
  });

  test("las alertas ignoradas en las reglas no cuentan", () => {
    const reglas = leerReglas(
      "40012\tIGNORE\tFalso positivo revisado: el parámetro no se refleja",
    );
    const r = resumirInforme(informe, reglas);
    assert.equal(r.porRiesgo[3], 0);
    assert.equal(r.ignoradas.length, 1);
    assert.equal(falla(r), false);
  });

  test("un informe vacío no falla", () => {
    const r = resumirInforme({ site: [] });
    assert.deepEqual(r.porRiesgo, [0, 0, 0, 0]);
    assert.equal(falla(r), false);
  });
});

describe("falla", () => {
  test("por defecto falla solo con riesgo alto", () => {
    assert.equal(falla(resumirInforme(informe)), true);
    const sinAlto = {
      site: [
        { alerts: informe.site[0].alerts.filter((a) => a.riskcode !== "3") },
      ],
    };
    assert.equal(falla(resumirInforme(sinAlto)), false);
    assert.equal(falla(resumirInforme(sinAlto), "medio"), true);
  });
});

describe("renderMarkdown", () => {
  test("muestra el estado, la tabla sin informativos y el aviso de los medios", () => {
    const md = renderMarkdown(resumirInforme(informe), "web");
    assert.match(md, /### DAST — web/);
    assert.match(md, /❌ Hay hallazgos de riesgo alto/);
    assert.match(
      md,
      /\| Alto \| Cross Site Scripting \(Reflected\) \| 40012 \| 79 \| 1 \|/,
    );
    assert.doesNotMatch(md, /Timestamp Disclosure/);
    assert.match(md, /Registrar cada alerta media como defecto/);
  });

  test("lista las ignoradas con su motivo", () => {
    const reglas = leerReglas(
      "40012\tIGNORE\tFalso positivo revisado: el parámetro no se refleja",
    );
    const md = renderMarkdown(resumirInforme(informe, reglas), "web");
    assert.match(md, /✅ Sin hallazgos de riesgo alto/);
    assert.match(md, /Falso positivo revisado/);
  });
});

// BL-525: el repositorio es público. Sin detalle (modo completo) no se
// publican nombres de alertas, URLs ni motivos: solo las cantidades.
describe("sin detalle (repositorio público)", () => {
  test("el resumen muestra las cantidades y el aviso, sin tabla ni URLs", () => {
    const md = renderMarkdown(
      resumirInforme(informe),
      "API (completo)",
      "alto",
      false,
    );
    assert.match(md, /❌ Hay hallazgos de riesgo alto/);
    assert.match(md, /Alto: \*\*1\*\* · Medio: \*\*1\*\*/);
    assert.ok(md.includes(AVISO_SIN_DETALLE));
    assert.match(md, /aviso de seguridad privado/);
    assert.doesNotMatch(md, /Cross Site Scripting/);
    assert.doesNotMatch(md, /railway\.app/);
    assert.doesNotMatch(md, /\| Riesgo \|/);
  });

  test("tampoco muestra los motivos de las ignoradas", () => {
    const reglas = leerReglas(
      "40012\tIGNORE\tFalso positivo revisado: el parámetro no se refleja",
    );
    const md = renderMarkdown(
      resumirInforme(informe, reglas),
      "API (completo)",
      "alto",
      false,
    );
    assert.match(md, /Revisadas e ignoradas: 1/);
    assert.doesNotMatch(md, /Falso positivo revisado/);
  });

  test("sin alertas altas ni medias no sugiere un aviso de seguridad", () => {
    const md = renderMarkdown(
      resumirInforme({ site: [] }),
      "API (completo)",
      "alto",
      false,
    );
    assert.match(md, /✅ Sin hallazgos de riesgo alto/);
    assert.doesNotMatch(md, /aviso de seguridad privado/);
  });
});

describe("anotaciones", () => {
  test("con detalle, una por alerta alta o media, con su nombre y URL", () => {
    const lineas = anotaciones(resumirInforme(informe), "web");
    assert.equal(lineas.length, 2);
    assert.match(
      lineas[0],
      /^::error title=ZAP web: Alto::Cross Site Scripting \(Reflected\) \(40012\)/,
    );
    assert.match(lineas[1], /^::warning .*railway\.app\/login/);
  });

  test("sin detalle, una sola con las cantidades y sin URLs", () => {
    const lineas = anotaciones(
      resumirInforme(informe),
      "API (completo)",
      false,
    );
    assert.deepEqual(lineas, [
      "::error title=ZAP API (completo)::Alto: 1 · Medio: 1. Detalle en el informe cifrado.",
    ]);
  });

  test("sin detalle y sin alertas altas ni medias, ninguna", () => {
    const sinRelevantes = {
      site: [
        {
          alerts: informe.site[0].alerts.filter((a) => Number(a.riskcode) < 2),
        },
      ],
    };
    assert.deepEqual(
      anotaciones(resumirInforme(sinRelevantes), "API (completo)", false),
      [],
    );
  });
});

// Verificación del 21/11/2026: falso positivo de inyección SQL acotado a dos
// rutas con OUTOFSCOPE, sin apagar la regla en el resto de la API.
const API = "https://bistrolink-api-staging.up.railway.app";
const informeSql = {
  site: [
    {
      "@name": API,
      alerts: [
        {
          pluginid: "40018",
          name: "SQL Injection",
          riskcode: "3",
          confidence: "2",
          count: "2",
          cweid: "89",
          instances: [
            { uri: `${API}/admin/menu/categoria`, method: "POST" },
            { uri: `${API}/admin/menu/imagenes/confirmar`, method: "POST" },
          ],
        },
      ],
    },
  ],
};
const REGLAS_SQL = [
  "# Falso positivo revisado: Prisma parametriza la consulta",
  "40018\tOUTOFSCOPE\thttps://[^/]+/admin/menu/categoria$",
  "",
  "# Falso positivo revisado: no consulta la base de datos",
  "40018\tOUTOFSCOPE\thttps://[^/]+/admin/menu/imagenes/confirmar$",
].join("\n");

describe("leerFueraDeAlcance", () => {
  test("lee las rutas por regla con el motivo del comentario anterior", () => {
    const fuera = leerFueraDeAlcance(REGLAS_SQL);
    assert.deepEqual([...fuera.keys()], ["40018"]);
    assert.equal(fuera.get("40018").length, 2);
    assert.equal(
      fuera.get("40018")[0].motivo,
      "Falso positivo revisado: Prisma parametriza la consulta",
    );
  });

  test("acepta varias reglas separadas por coma y «*» para todas", () => {
    const fuera = leerFueraDeAlcance(
      "# motivo de prueba largo\n10010,10011\tOUTOFSCOPE\thttps://x/a$\n# otro motivo largo\n*\tOUTOFSCOPE\thttps://x/b$",
    );
    assert.deepEqual([...fuera.keys()].sort(), ["*", "10010", "10011"]);
  });

  test("leerReglas no toma las líneas OUTOFSCOPE como acción de la regla", () => {
    assert.equal(leerReglas(REGLAS_SQL).has("40018"), false);
  });

  test("la regex se compara desde el principio de la URL, como ZAP", () => {
    const [entrada] = leerFueraDeAlcance(
      "# motivo de prueba largo\n40018\tOUTOFSCOPE\t/admin/menu/categoria$",
    ).get("40018");
    assert.equal(entrada.patron.test(`${API}/admin/menu/categoria`), false);
    assert.equal(entrada.patron.test("/admin/menu/categoria"), true);
  });

  test("el archivo real: cada OUTOFSCOPE tiene motivo y una ruta concreta", () => {
    const fuera = leerFueraDeAlcance(
      readFileSync(new URL("./reglas-zap.tsv", import.meta.url), "utf-8"),
    );
    for (const [id, entradas] of fuera) {
      for (const e of entradas) {
        assert.ok(
          e.motivo.length > 10,
          `OUTOFSCOPE de ${id} sin motivo: ${e.regex}`,
        );
        assert.ok(
          e.regex.endsWith("$"),
          `OUTOFSCOPE de ${id} sin «$»: ${e.regex}`,
        );
        assert.match(
          e.regex,
          /\/[a-z]/,
          `OUTOFSCOPE de ${id} sin ruta: ${e.regex}`,
        );
      }
    }
  });
});

describe("resumirInforme con OUTOFSCOPE", () => {
  test("si todas las instancias están fuera de alcance, la alerta no cuenta", () => {
    const r = resumirInforme(
      informeSql,
      leerReglas(REGLAS_SQL),
      leerFueraDeAlcance(REGLAS_SQL),
    );
    assert.equal(r.porRiesgo[3], 0);
    assert.equal(r.ignoradas.length, 1);
    assert.equal(falla(r), false);
  });

  test("una instancia en otra ruta sigue contando: la regla no se apaga", () => {
    const otra = structuredClone(informeSql);
    otra.site[0].alerts[0].count = "3";
    otra.site[0].alerts[0].instances.push({
      uri: `${API}/pedidos`,
      method: "POST",
    });
    const r = resumirInforme(
      otra,
      leerReglas(REGLAS_SQL),
      leerFueraDeAlcance(REGLAS_SQL),
    );
    assert.equal(r.porRiesgo[3], 1);
    assert.equal(r.vigentes[0].cantidad, 1);
    assert.equal(r.vigentes[0].ejemplo, `POST ${API}/pedidos`);
    assert.equal(falla(r), true);
  });

  test("las rutas parecidas no quedan fuera de alcance", () => {
    const parecida = structuredClone(informeSql);
    parecida.site[0].alerts[0].instances = [
      { uri: `${API}/admin/menu/categoria/123`, method: "PUT" },
    ];
    parecida.site[0].alerts[0].count = "1";
    const r = resumirInforme(
      parecida,
      leerReglas(REGLAS_SQL),
      leerFueraDeAlcance(REGLAS_SQL),
    );
    assert.equal(falla(r), true);
  });
});
