import { expect, type Page } from "@playwright/test";

/**
 * HU-043 (BL-535): marca del local para los E2E de `admin/marca.spec.ts`.
 *
 * Las imágenes son PNG chicos generados para la prueba (sin datos de nadie):
 * pasan por la carga segura de siempre (presigned URL, cuarentena y
 * confirmación con destino `marca` o `portada`).
 *
 * ⚠️ Cambian la marca de TODO el establecimiento del seed: el spec corre en
 * el proyecto `chromium-configuracion`, después de los demás (ver
 * playwright.config.ts). Igual, cada test deja la marca como la encontró y
 * la limpieza de staging (BL-535) quita el logo y la portada que queden.
 */

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const CONFIGURACION_PATH = "/admin/configuracion";

/** Logo de 64 × 64 px: un círculo rojo sobre fondo transparente. */
export const LOGO_PNG = {
  name: "logo-e2e.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAArUlEQVR42u3byw2AIBAEUCrxaP+JBWIPymeXfZNYwLybMLQmIiIiM/PcV//6lS2eFmJk6XQYK8qHRFhZPBzEzvLbESKU34YQqfxyhIjllyFELj8dIUP5qQilATKVH46QsfxQBACVATKXH4JQGuCE8r8QAAAAAAAAAAAAAAAAAACAX2IHIo7FHIoCcDnSXY+5HC0MUH4fYCFiI2QlZidoKWorbC3uvYAXIyIickZeJlgoj7kwUvwAAAAASUVORK5CYII=",
    "base64",
  ),
};

/** Portada de 160 × 90 px (horizontal): dos franjas de color. */
export const PORTADA_PNG = {
  name: "portada-e2e.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAYAAAA/xl1SAAAAyUlEQVR42u3SMQ0AIAwAwfrAAxbYMIMpnLYmmnS54Qx8PvY7CVNCBAyIAcGAGBAMiAHBgBgQDIgBwYAYEAyIAcGAGBAMiAHBgBgQDIgBwYAYEAyIAcGAGBAMiAHBgBgQAwqBATEgGBADggExIBgQA4IBMSD0D/jvSphiQAyIAcGAGBAMiAHBgBgQDIgBwYAYEAyIAcGAGBAMiAHBgBgQDIgBwYAYEAyIAcGAGBAMiAHBgBgQA4qAATEgGBADggExIBgQA4IBMSD0K3L0BTX2X21oAAAAAElFTkSuQmCC",
    "base64",
  ),
};

/** Lo que el test puede cambiar de la marca, como lo guarda la API. */
export interface MarcaGuardada {
  nombre: string;
  direccion: string;
  plantilla: string;
  logoUrl: string | null;
  portadaUrl: string | null;
}

export interface SesionMarca {
  /** Bearer del Administrador, para la API. */
  authorization: string;
  /** Cómo estaba la marca al empezar, para dejarla igual. */
  original: MarcaGuardada;
}

/** Abre Configuración como admin: devuelve el Bearer y la marca guardada. */
export async function abrirConfiguracionDeMarca(
  page: Page,
): Promise<SesionMarca> {
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
  const configuracion = (await respuesta.json()) as MarcaGuardada;
  await expect(
    page.getByRole("heading", { name: "Marca del local" }),
  ).toBeVisible();
  return {
    authorization: respuesta.request().headers()["authorization"],
    original: {
      nombre: configuracion.nombre,
      direccion: configuracion.direccion,
      plantilla: configuracion.plantilla,
      logoUrl: configuracion.logoUrl,
      portadaUrl: configuracion.portadaUrl,
    },
  };
}

/**
 * Deja la marca como estaba: nombre, dirección y plantilla originales, y
 * sin el logo ni la portada que subió el test (si al empezar había, los
 * quita igual: el seed no tiene). Manda solo lo que cambió, porque la API
 * responde 400 «No hay cambios» si no hay nada.
 */
export async function restaurarMarca(
  page: Page,
  { authorization, original }: SesionMarca,
): Promise<void> {
  const actual = await page.request.get(`${API_URL}${CONFIGURACION_PATH}`, {
    headers: { authorization },
  });
  expect(actual.status()).toBe(200);
  const ahora = (await actual.json()) as MarcaGuardada;

  const cambios: Record<string, string | null> = {};
  if (ahora.nombre !== original.nombre) cambios.nombre = original.nombre;
  if (ahora.direccion !== original.direccion) {
    cambios.direccion = original.direccion;
  }
  if (ahora.plantilla !== original.plantilla) {
    cambios.plantilla = original.plantilla;
  }
  if (ahora.logoUrl) cambios.logoKey = null;
  if (ahora.portadaUrl) cambios.portadaKey = null;
  if (Object.keys(cambios).length === 0) return;

  const res = await page.request.patch(`${API_URL}${CONFIGURACION_PATH}`, {
    headers: { authorization },
    data: cambios,
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** «Guardar cambios» y el aviso de que se guardó. */
export async function guardarCambios(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
}
