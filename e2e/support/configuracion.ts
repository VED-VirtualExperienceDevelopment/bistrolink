import { expect, type Page } from "@playwright/test";

/**
 * BL-452: cambiar los medios de pago del establecimiento del seed para un
 * E2E y dejarlos como estaban al terminar.
 *
 * Se usa la pestaña ya logueada del fixture `kdsPageAdmin`: abre
 * /admin/configuracion, toma el Bearer que mandó el frontend y cambia la
 * configuración por la API (PATCH /admin/configuracion), igual que la
 * pantalla.
 *
 * ⚠️ Cambia la configuración de TODO el establecimiento del seed: un test de
 * pago que corra al mismo tiempo vería esos medios apagados. Por eso los
 * specs que lo usan corren en su propio proyecto de Playwright
 * (`chromium-configuracion`), después de `chromium` (ver
 * playwright.config.ts).
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const CONFIGURACION_PATH = "/admin/configuracion";

export interface MediosDePago {
  efectivoHabilitado: boolean;
  mercadoPagoHabilitado: boolean;
}

export interface SesionConfiguracion {
  /** Bearer del Administrador, para la API. */
  authorization: string;
  /** Cómo estaban los medios al empezar, para restaurarlos. */
  original: MediosDePago;
}

/** Abre la configuración como admin y devuelve el Bearer y los medios actuales. */
export async function abrirConfiguracion(
  page: Page,
): Promise<SesionConfiguracion> {
  const [respuesta] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith(CONFIGURACION_PATH) &&
        r.request().method() === "GET" &&
        Boolean(r.request().headers()["authorization"]),
    ),
    page.goto(CONFIGURACION_PATH),
  ]);
  expect(respuesta.status()).toBe(200);
  const configuracion = (await respuesta.json()) as MediosDePago;
  return {
    authorization: respuesta.request().headers()["authorization"],
    original: {
      efectivoHabilitado: configuracion.efectivoHabilitado,
      mercadoPagoHabilitado: configuracion.mercadoPagoHabilitado,
    },
  };
}

/** Cambia los medios de pago por la API, como el botón «Guardar cambios». */
export async function cambiarMediosDePago(
  page: Page,
  authorization: string,
  medios: Partial<MediosDePago>,
): Promise<void> {
  const res = await page.request.patch(`${API_URL}${CONFIGURACION_PATH}`, {
    headers: { authorization },
    data: medios,
  });
  expect(res.status(), await res.text()).toBe(200);
}
