// BL-478: tests del script de limpieza. Sin dependencias:
//   node --test scripts/limpieza/limpiar-entorno.test.mjs
// Keycloak y la API se reemplazan por un servidor HTTP local.

import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import {
  codigoOtp,
  configuracion,
  describirArea,
  leerArgumentos,
  leerEnv,
  limpiar,
  resumenMarkdown,
} from "./limpiar-entorno.mjs";

describe("leerArgumentos", () => {
  test("por defecto: local, dry-run, todos los pedidos", () => {
    assert.deepEqual(leerArgumentos([]), {
      entorno: "local",
      aplicar: false,
      antiguedadHoras: 0,
    });
  });

  test("staging usa 24 h por defecto; --antiguedad-horas lo cambia", () => {
    assert.equal(leerArgumentos(["--entorno", "staging"]).antiguedadHoras, 24);
    const opciones = leerArgumentos([
      "--entorno=staging",
      "--aplicar",
      "--antiguedad-horas",
      "0",
    ]);
    assert.equal(opciones.aplicar, true);
    assert.equal(opciones.antiguedadHoras, 0);
  });

  test("rechaza producción, opciones desconocidas y horas inválidas", () => {
    assert.throws(
      () => leerArgumentos(["--entorno", "production"]),
      /nunca producción/,
    );
    assert.throws(() => leerArgumentos(["--borrar"]), /desconocida/);
    assert.throws(
      () => leerArgumentos(["--antiguedad-horas", "-1"]),
      /entre 0 y 720/,
    );
    assert.throws(
      () => leerArgumentos(["--antiguedad-horas", "721"]),
      /entre 0 y 720/,
    );
    assert.throws(() => leerArgumentos(["--entorno"]), /Falta el valor/);
  });
});

describe("configuración", () => {
  test("leerEnv: quita comillas, espacios y comentarios", () => {
    assert.deepEqual(
      leerEnv(
        "A=1\nB = 'dos'\nC=\"tres\" \n# nada\nD=4 # comentario\nexport E=5",
      ),
      { A: "1", B: "dos", C: "tres", D: "4", E: "5" },
    );
  });

  test("local: completa con el .env; la sesión manda", () => {
    const archivo = join(mkdtempSync(join(tmpdir(), "limpieza-")), ".env");
    writeFileSync(
      archivo,
      "KEYCLOAK_CLIENT_SECRET=del-archivo\nTEST_ADMIN_USERNAME=admin-archivo\nTEST_ADMIN_PASSWORD=clave\n",
    );
    const config = configuracion(
      "local",
      { API_URL: "http://otra:3001/", TEST_ADMIN_USERNAME: "admin-sesion" },
      archivo,
    );
    assert.equal(config.apiUrl, "http://otra:3001");
    assert.equal(config.keycloakUrl, "http://localhost:8080");
    assert.equal(config.clientId, "bistrolink-backend");
    assert.equal(config.clientSecret, "del-archivo");
    assert.equal(config.variable("TEST_ADMIN_USERNAME"), "admin-sesion");
    assert.equal(config.variable("TEST_ADMIN_PASSWORD"), "clave");
  });

  test("staging: no lee el .env de la PC", () => {
    const archivo = join(mkdtempSync(join(tmpdir(), "limpieza-")), ".env");
    writeFileSync(archivo, "KEYCLOAK_CLIENT_SECRET=local\n");
    assert.equal(configuracion("staging", {}, archivo).clientSecret, "");
  });

  test("no apunta nunca a producción", () => {
    assert.throws(
      () =>
        configuracion("staging", {
          API_URL: "https://bistrolink-api-production.up.railway.app",
        }),
      /producción/,
    );
  });
});

describe("codigoOtp", () => {
  // RFC 6238, apéndice B: clave ASCII «12345678901234567890», T = 59 s.
  const CLAVE = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  test("vector de la RFC 6238 (SHA1, últimos 6 dígitos)", () => {
    assert.equal(codigoOtp(CLAVE, 0, 59_000), "287082");
    assert.equal(codigoOtp(CLAVE, 0, 1_111_111_109_000), "081804");
  });
  test("el desplazamiento 1 es la ventana siguiente", () => {
    assert.equal(codigoOtp(CLAVE, 1, 59_000 - 30_000), "287082");
  });
});

describe("resumen", () => {
  test("describirArea: solo lo que cambió", () => {
    assert.equal(
      describirArea("pedidos", {
        encontrados: {},
        cancelados: 2,
        entregados: 0,
      }),
      "2 cancelados (sin pagar)",
    );
    assert.equal(
      describirArea("mesas", { reabiertas: 0, eliminadas: 0 }),
      "nada",
    );
    assert.equal(
      describirArea("configuracion", {
        camposRestablecidos: ["plexoHabilitado"],
      }),
      "restablecidos: plexoHabilitado",
    );
    assert.equal(describirArea("carta", undefined), "—");
  });

  test("resumenMarkdown: dice si fue simulación", () => {
    const md = resumenMarkdown({
      entorno: "staging",
      aplicar: false,
      antiguedadHoras: 24,
      filas: [["Tenant A", "pedidos", "nada"]],
      errores: [],
      alertas: [],
    });
    assert.match(md, /simulación, dry-run/);
    assert.match(md, /\| Tenant A \| pedidos \| nada \|/);
  });
});

describe("limpiar (contra un Keycloak y una API falsos)", () => {
  let servidor;
  let url;
  const llamadas = [];
  let respuestaLimpieza = 200;
  let intentosPlataforma = 0;

  before(async () => {
    servidor = createServer((req, res) => {
      let cuerpo = "";
      req.on("data", (c) => (cuerpo += c));
      req.on("end", () => {
        const json = (status, datos) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(datos));
        };
        if (req.url.endsWith("/protocol/openid-connect/token")) {
          const p = new URLSearchParams(cuerpo);
          llamadas.push({ token: p.get("username"), totp: p.get("totp") });
          if (p.get("client_secret") !== "secreto")
            return json(401, { error: "unauthorized_client" });
          // El usuario de plataforma: el primer código se rechaza (ya usado).
          if (
            p.get("username") === "plataforma" &&
            (intentosPlataforma += 1) % 2 === 1
          ) {
            return json(401, {
              error: "invalid_grant",
              error_description: "Invalid user credentials",
            });
          }
          return json(200, { access_token: `tok-${p.get("username")}` });
        }
        llamadas.push({
          ruta: req.url,
          auth: req.headers.authorization,
          cuerpo: JSON.parse(cuerpo),
        });
        if (respuestaLimpieza === 404)
          return json(404, { message: "Cannot POST" });
        if (req.url === "/testing/limpieza") {
          return json(200, {
            dryRun: true,
            pedidos: {
              encontrados: { RECIBIDO: 1 },
              cancelados: 0,
              entregados: 1,
            },
            mesas: {
              reabiertas: 0,
              liberadas: 0,
              eliminadas: 1,
              temporalesConPedidos: 0,
              zonasEliminadas: 0,
            },
            carta: {
              itemsEliminados: 0,
              itemsArchivados: 0,
              categoriasEliminadas: 0,
              categoriasArchivadas: 0,
              seedRestablecido: 0,
            },
            configuracion: { camposRestablecidos: [] },
            usuarios: { eliminados: 0, desactivados: 0, conError: 1 },
          });
        }
        return json(200, {
          dryRun: true,
          eliminados: 1,
          suspendidos: 0,
          cuentasPendientes: 0,
          conError: 0,
        });
      });
    });
    await new Promise((r) => servidor.listen(0, r));
    url = `http://127.0.0.1:${servidor.address().port}`;
  });
  after(() => servidor.close());

  const sesion = () => ({
    API_URL: url,
    KEYCLOAK_URL: url,
    KEYCLOAK_CLIENT_SECRET: "secreto",
    TEST_ADMIN_USERNAME: "admin-a",
    TEST_ADMIN_PASSWORD: "x",
    TEST_TENANT_B_USERNAME: "admin-b",
    TEST_TENANT_B_PASSWORD: "x",
    TEST_PLATAFORMA_USERNAME: "plataforma",
    TEST_PLATAFORMA_PASSWORD: "x",
    TEST_PLATAFORMA_OTP_SECRET: "JBSWY3DPEHPK3PXP",
  });

  test("limpia A, B y plataforma; reintenta el OTP con la ventana siguiente", async () => {
    llamadas.length = 0;
    respuestaLimpieza = 200;
    const { filas, errores, alertas } = await limpiar(
      { entorno: "staging", aplicar: false, antiguedadHoras: 24 },
      configuracion("staging", sesion()),
    );
    assert.deepEqual(errores, []);
    const api = llamadas.filter((l) => l.ruta);
    assert.deepEqual(
      api.map((l) => [l.ruta, l.auth]),
      [
        ["/testing/limpieza", "Bearer tok-admin-a"],
        ["/testing/limpieza", "Bearer tok-admin-b"],
        ["/testing/limpieza/establecimientos", "Bearer tok-plataforma"],
      ],
    );
    assert.deepEqual(api[0].cuerpo, { dryRun: true, antiguedadHoras: 24 });
    assert.deepEqual(api[2].cuerpo, { dryRun: true });
    const otps = llamadas
      .filter((l) => l.token === "plataforma")
      .map((l) => l.totp);
    assert.equal(otps.length, 2);
    assert.notEqual(otps[0], otps[1]);
    assert.equal(filas.length, 11);
    assert.ok(alertas.some((a) => /con error en usuarios/.test(a)));
  });

  test("con --aplicar manda dryRun false", async () => {
    llamadas.length = 0;
    await limpiar(
      { entorno: "staging", aplicar: true, antiguedadHoras: 0 },
      configuracion("staging", sesion()),
    );
    const api = llamadas.filter((l) => l.ruta);
    assert.deepEqual(api[0].cuerpo, { dryRun: false, antiguedadHoras: 0 });
    assert.deepEqual(api[2].cuerpo, { dryRun: false });
  });

  test("404: avisa que falta E2E_CLEANUP_ENABLED", async () => {
    respuestaLimpieza = 404;
    const { errores } = await limpiar(
      { entorno: "staging", aplicar: false, antiguedadHoras: 24 },
      configuracion("staging", sesion()),
    );
    respuestaLimpieza = 200;
    assert.equal(errores.length, 3);
    assert.ok(errores.every((e) => /E2E_CLEANUP_ENABLED/.test(e)));
  });

  test("sin credenciales de B ni de plataforma: error de B y aviso de plataforma", async () => {
    const parcial = sesion();
    delete parcial.TEST_TENANT_B_PASSWORD;
    delete parcial.TEST_PLATAFORMA_OTP_SECRET;
    const { errores, alertas } = await limpiar(
      { entorno: "staging", aplicar: false, antiguedadHoras: 24 },
      configuracion("staging", parcial),
    );
    assert.deepEqual(errores, [
      "Tenant B (Restaurante Testing B): faltan TEST_TENANT_B_USERNAME o TEST_TENANT_B_PASSWORD.",
    ]);
    assert.ok(alertas.some((a) => /Plataforma: se saltea/.test(a)));
  });

  test("sin client secret no llama a nadie", async () => {
    llamadas.length = 0;
    const sinSecreto = sesion();
    delete sinSecreto.KEYCLOAK_CLIENT_SECRET;
    const { errores } = await limpiar(
      { entorno: "staging", aplicar: false, antiguedadHoras: 24 },
      configuracion("staging", sinSecreto),
    );
    assert.match(errores[0], /KEYCLOAK_CLIENT_SECRET/);
    assert.equal(llamadas.length, 0);
  });
});
