// BL-326: tests de la configuración del envío del email de estado.
// No mandan correos ni se conectan a ningún servidor:
//   node --test scripts/dashboards/enviar-email.test.mjs

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { leerConfiguracion } from "./enviar-email.mjs";

const BASE = {
  MAIL_USERNAME: "remitente@ejemplo.com",
  MAIL_PASSWORD: "clave-de-prueba",
  EMAIL_TO: "a@ejemplo.com, b@ejemplo.com,c@ejemplo.com",
  EMAIL_FROM: "BistroLink Dashboard <remitente@ejemplo.com>",
  EMAIL_SUBJECT: "  BistroLink — Estado del proyecto  ",
  EMAIL_BODY_PATH: "email-status.html",
};

describe("leerConfiguracion", () => {
  test("con todas las variables arma el transporte y el mensaje", () => {
    const { transporte, mensaje, rutaCuerpo } = leerConfiguracion(BASE);

    assert.equal(transporte.host, "smtp.gmail.com");
    assert.equal(transporte.port, 465);
    assert.equal(transporte.secure, true);
    assert.deepEqual(transporte.auth, {
      user: "remitente@ejemplo.com",
      pass: "clave-de-prueba",
    });
    assert.deepEqual(mensaje.to, [
      "a@ejemplo.com",
      "b@ejemplo.com",
      "c@ejemplo.com",
    ]);
    assert.equal(mensaje.from, "BistroLink Dashboard <remitente@ejemplo.com>");
    assert.equal(mensaje.subject, "BistroLink — Estado del proyecto");
    assert.equal(rutaCuerpo, "email-status.html");
  });

  test("sin EMAIL_CC el mensaje no lleva copia", () => {
    assert.equal("cc" in leerConfiguracion(BASE).mensaje, false);
    assert.equal(
      "cc" in leerConfiguracion({ ...BASE, EMAIL_CC: " , " }).mensaje,
      false,
    );
  });

  test("con EMAIL_CC agrega la copia, sin vacíos", () => {
    const { mensaje } = leerConfiguracion({
      ...BASE,
      EMAIL_CC: " d@ejemplo.com, ,e@ejemplo.com ",
    });
    assert.deepEqual(mensaje.cc, ["d@ejemplo.com", "e@ejemplo.com"]);
  });

  test("nombra todas las variables que faltan o están vacías", () => {
    assert.throws(
      () =>
        leerConfiguracion({
          ...BASE,
          MAIL_PASSWORD: "",
          EMAIL_TO: "   ",
          EMAIL_FROM: undefined,
        }),
      /Faltan variables de entorno: MAIL_PASSWORD, EMAIL_TO, EMAIL_FROM/,
    );
  });

  test("el error no incluye el valor de la contraseña", () => {
    try {
      leerConfiguracion({ ...BASE, MAIL_USERNAME: "" });
      assert.fail("tenía que fallar");
    } catch (err) {
      assert.doesNotMatch(err.message, /clave-de-prueba/);
    }
  });

  test("falla si EMAIL_TO solo tiene comas", () => {
    assert.throws(
      () => leerConfiguracion({ ...BASE, EMAIL_TO: " , ," }),
      /no tiene destinatarios/,
    );
  });

  test("en otro puerto exige STARTTLS en lugar de TLS directo", () => {
    const { transporte } = leerConfiguracion({ ...BASE, SMTP_PORT: "587" });
    assert.equal(transporte.port, 587);
    assert.equal(transporte.secure, false);
    assert.equal(transporte.requireTLS, true);
  });

  test("acepta otro servidor SMTP", () => {
    const { transporte } = leerConfiguracion({
      ...BASE,
      SMTP_HOST: " smtp.otro.com ",
    });
    assert.equal(transporte.host, "smtp.otro.com");
  });

  test("rechaza un puerto inválido", () => {
    for (const puerto of ["abc", "0", "-1", "70000", "465.5"]) {
      assert.throws(
        () => leerConfiguracion({ ...BASE, SMTP_PORT: puerto }),
        /SMTP_PORT/,
      );
    }
  });
});
