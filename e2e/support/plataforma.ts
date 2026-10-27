import { createHmac } from "crypto";
import type { APIRequestContext, Page } from "@playwright/test";

// BL-416: ingreso a /plataforma y datos de prueba para los E2E del rol
// PLATAFORMA.
//
// El usuario de plataforma de E2E tiene OTP, como cualquier cuenta
// PLATAFORMA (BL-163). El test genera el código de un solo uso con la clave
// de su app de autenticación (TEST_PLATAFORMA_OTP_SECRET), con el mismo
// algoritmo que Google Authenticator: TOTP de 6 dígitos cada 30 segundos con
// HMAC-SHA1 (RFC 6238), que es la política por defecto del realm.
//
// Las tres variables salen de los secrets del CI; en local, de la sesión
// (ver e2e/README.md). Nunca se escriben en un spec ni en un commit.

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const PERIODO_OTP_S = 30;

interface CredencialesPlataforma {
  username: string;
  password: string;
  otpSecret: string;
}

/** Si están las tres variables del usuario de plataforma de E2E. */
export function hayCredencialesPlataforma(): boolean {
  return Boolean(
    process.env.TEST_PLATAFORMA_USERNAME &&
    process.env.TEST_PLATAFORMA_PASSWORD &&
    process.env.TEST_PLATAFORMA_OTP_SECRET,
  );
}

function credencialesPlataforma(): CredencialesPlataforma {
  if (!hayCredencialesPlataforma()) {
    throw new Error(
      "Faltan TEST_PLATAFORMA_USERNAME, TEST_PLATAFORMA_PASSWORD o TEST_PLATAFORMA_OTP_SECRET (ver e2e/README.md).",
    );
  }
  return {
    username: process.env.TEST_PLATAFORMA_USERNAME as string,
    password: process.env.TEST_PLATAFORMA_PASSWORD as string,
    otpSecret: process.env.TEST_PLATAFORMA_OTP_SECRET as string,
  };
}

/** Decodifica la clave en Base32, como la muestra Keycloak (con o sin espacios). */
function base32(clave: string): Buffer {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const limpia = clave.toUpperCase().replace(/[\s=-]/g, "");
  let bits = "";
  for (const caracter of limpia) {
    const valor = alfabeto.indexOf(caracter);
    if (valor < 0) {
      throw new Error("TEST_PLATAFORMA_OTP_SECRET no es una clave Base32");
    }
    bits += valor.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Código TOTP de 6 dígitos. `desplazamiento` corre la ventana de 30 s: 1 es
 * el código de la ventana siguiente, que Keycloak también acepta (mira una
 * ventana para cada lado).
 */
export function codigoOtp(
  clave: string,
  desplazamiento = 0,
  ahoraMs = Date.now(),
): string {
  const paso = Math.floor(ahoraMs / 1000 / PERIODO_OTP_S) + desplazamiento;
  const contador = Buffer.alloc(8);
  contador.writeUInt32BE(Math.floor(paso / 2 ** 32), 0);
  contador.writeUInt32BE(paso % 2 ** 32, 4);
  const hmac = createHmac("sha1", base32(clave)).update(contador).digest();
  const inicio = hmac[hmac.length - 1] & 0x0f;
  const numero = (hmac.readUInt32BE(inicio) & 0x7fffffff) % 1_000_000;
  return String(numero).padStart(6, "0");
}

/**
 * Ingresa a /plataforma con el usuario de E2E (usuario, contraseña y OTP) y
 * devuelve el Bearer que el frontend manda a la API, para preparar y limpiar
 * datos.
 *
 * Keycloak no acepta dos veces el mismo código: si una corrida anterior (o
 * el reintento del CI) ya lo usó en esta ventana de 30 s, se prueba con el
 * de la ventana siguiente.
 */
export async function ingresarPlataforma(page: Page): Promise<string> {
  const { username, password, otpSecret } = credencialesPlataforma();

  await page.goto("/plataforma");
  await page.waitForURL(/\/login|\/realms\//);
  if (/\/login(?:\?|$)/.test(page.url())) {
    await page.getByRole("button", { name: /ingresar/i }).click();
    await page.waitForURL(/\/realms\//);
  }
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page
    .getByRole("button", { name: /ingresar|iniciar sesión|sign in/i })
    .click();

  const campoOtp = page.locator('input[name="otp"]');
  const pedidoListado = page.waitForRequest(
    (req) =>
      new URL(req.url()).pathname === "/plataforma/establecimientos" &&
      Boolean(req.headers()["authorization"]),
  );
  for (const desplazamiento of [0, 1]) {
    await campoOtp.fill(codigoOtp(otpSecret, desplazamiento));
    await page
      .getByRole("button", { name: /ingresar|iniciar sesión|sign in/i })
      .click();
    // Lo que pase primero: vuelve a /plataforma o Keycloak muestra el error
    // del código. El que pierde termina por timeout y se descarta.
    const resultado = await Promise.race([
      page
        .waitForURL((url) => url.pathname === "/plataforma")
        .then(() => "adentro" as const)
        .catch(() => "sin respuesta" as const),
      page
        .locator("#input-error-otp-code, #input-error, .kc-feedback-text")
        .first()
        .waitFor()
        .then(() => "rechazado" as const)
        .catch(() => "sin respuesta" as const),
    ]);
    if (resultado === "adentro") break;
    if (desplazamiento === 1) {
      throw new Error(
        `No se pudo ingresar con el OTP del usuario de E2E (${resultado})`,
      );
    }
  }

  await page
    .getByRole("heading", { level: 1, name: "Establecimientos" })
    .waitFor({ timeout: 15_000 });
  return (await pedidoListado).headers()["authorization"];
}

// ── Establecimiento de prueba ───────────────────────────────────────────────

const PESOS_RUT = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** BL-409: RUT válido con registro 21, seis dígitos, `001` y el verificador. */
function rutValido(numero: number): string | null {
  const base = `21${String(numero % 1_000_000).padStart(6, "0")}001`;
  if (base.slice(2, 8) === "000000") return null;
  let suma = 0;
  for (let i = 0; i < PESOS_RUT.length; i++) {
    suma += Number(base[i]) * PESOS_RUT[i];
  }
  const digito = (11 - (suma % 11)) % 11;
  return digito === 10 ? null : `${base}${digito}`;
}

export interface EstablecimientoDePrueba {
  tenantId: string;
  razonSocial: string;
  rut: string;
}

/**
 * Da de alta un establecimiento de prueba por la API, con un RUT que no use
 * ningún otro (se busca antes en el listado: el alta con un RUT existente
 * retoma ESE establecimiento en lugar de crear uno nuevo).
 */
export async function crearEstablecimiento(
  request: APIRequestContext,
  authorization: string,
): Promise<EstablecimientoDePrueba> {
  const sufijo = Date.now().toString().slice(-8);
  let rut: string | null = null;
  for (let intento = 0; intento < 20 && !rut; intento++) {
    const candidato = rutValido(Number(sufijo.slice(-6)) + intento);
    if (!candidato) continue;
    const res = await request.get(`${API_URL}/plataforma/establecimientos`, {
      headers: { authorization },
      params: { q: candidato },
    });
    if (res.ok() && (await res.json()).total === 0) rut = candidato;
  }
  if (!rut) throw new Error("No se encontró un RUT libre para el test");

  const razonSocial = `E2E Plataforma ${sufijo} SRL`;
  const res = await request.post(`${API_URL}/plataforma/establecimientos`, {
    headers: { authorization },
    data: {
      razonSocial,
      rut,
      restaurante: {
        nombre: `E2E Plataforma ${sufijo}`,
        direccion: "Calle E2E 1",
      },
      admin: {
        username: `e2e-pg-admin-${sufijo}`,
        email: `e2e-pg-admin-${sufijo}@prueba.bistrolink.local`,
        nombre: "Admin",
        apellido: "Prueba",
      },
      cocina: { username: `e2e-pg-cocina-${sufijo}` },
    },
  });
  if (res.status() !== 201) {
    throw new Error(
      `El alta del establecimiento de prueba respondió ${res.status()}`,
    );
  }
  const { tenantId } = (await res.json()) as { tenantId: string };
  return { tenantId, razonSocial, rut };
}

/**
 * Limpieza: elimina el establecimiento de prueba (y sus cuentas de Keycloak)
 * si todavía existe. No lanza: es para el afterAll.
 */
export async function eliminarEstablecimiento(
  request: APIRequestContext,
  authorization: string,
  establecimiento: EstablecimientoDePrueba,
): Promise<void> {
  const ruta = `${API_URL}/plataforma/establecimientos/${establecimiento.tenantId}`;
  try {
    const ficha = await request.get(ruta, { headers: { authorization } });
    if (ficha.status() === 404) return;
    await request.delete(ruta, {
      headers: { authorization },
      data: { rut: establecimiento.rut },
    });
  } catch (error) {
    console.error(
      `No se pudo eliminar el establecimiento de prueba ${establecimiento.tenantId}: ${String(error)}`,
    );
  }
}
