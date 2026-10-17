import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/auth";

// E2E de HU-028 (BL-173): plano completo del salón (zonas y elementos fijos).
//
// El mapa vive en /admin/mesas. Se usan las pestañas ya logueadas de los
// fixtures kdsPageAdmin / kdsPageMozo (support/auth.ts): la sesión de
// Keycloak es la misma, solo se navega a otra ruta.
//
// ⚠️ Staging es compartido: el test que guarda (TC-E-020) restaura el plano
// que había antes, en un `finally`, aunque el test falle a mitad de camino.

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const MESAS_PATH = "/admin/mesas";

interface Zona {
  id: string;
  etiqueta: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

interface Elemento {
  id: string;
  tipo: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  rotacion: number;
}

interface Plano {
  elementos: Elemento[];
  zonas: Zona[];
}

interface MapaAbierto {
  /** Lo que respondió GET /mesas/plano al cargar la página. */
  plano: Plano;
  /** Bearer que mandó el frontend, para restaurar el plano por API. */
  authorization: string;
  restauranteId: string;
}

/**
 * Abre el mapa y espera a que cargue. Devuelve la respuesta de
 * GET /mesas/plano: verificar contra la API (y no contra el canvas) es lo
 * que hace confiable la comparación de posiciones.
 */
async function abrirMapa(page: Page): Promise<MapaAbierto> {
  const [respuesta] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/mesas/plano?") && r.request().method() === "GET",
    ),
    page.goto(MESAS_PATH),
  ]);
  expect(respuesta.status()).toBe(200);
  await expect(page.locator("canvas").first()).toBeVisible();

  return {
    plano: (await respuesta.json()) as Plano,
    authorization: respuesta.request().headers()["authorization"],
    restauranteId:
      new URL(respuesta.url()).searchParams.get("restauranteId") ?? "",
  };
}

/** Copia solo los campos que acepta el backend (forbidNonWhitelisted). */
function planoParaGuardar(plano: Plano): Plano {
  return {
    elementos: plano.elementos.map(
      ({ id, tipo, x, y, ancho, alto, rotacion }) => ({
        id,
        tipo,
        x,
        y,
        ancho,
        alto,
        rotacion,
      }),
    ),
    zonas: plano.zonas.map(({ id, etiqueta, x, y, ancho, alto }) => ({
      id,
      etiqueta,
      x,
      y,
      ancho,
      alto,
    })),
  };
}

test.describe("HU-028 · Plano completo del salón", () => {
  test("[TC-E-020] HU-028: una zona y un elemento fijo agregados se mantienen en su posición al guardar y recargar", async ({
    kdsPageAdmin: page,
  }) => {
    // Nombre único por corrida (solo letras, números y espacios: lo que
    // acepta el backend), para encontrar la zona sin confundirla con otras.
    const nombreZona = `Zona E2E ${Date.now() % 100_000}`;
    const {
      plano: original,
      authorization,
      restauranteId,
    } = await abrirMapa(page);

    try {
      await page.getByRole("button", { name: "Agregar zona" }).click();
      await page.getByLabel("Nombre de la zona").fill(nombreZona);
      await page.getByRole("button", { name: "Puerta", exact: true }).click();
      await expect(page.getByText("Cambios sin guardar")).toBeVisible();

      const [post] = await Promise.all([
        page.waitForRequest(
          (r) => r.url().endsWith("/mesas/layout") && r.method() === "POST",
        ),
        page.getByRole("button", { name: "Guardar mapa" }).click(),
      ]);
      await expect(page.getByText("Guardado ✓")).toBeVisible();

      const enviado = (post.postDataJSON() as { plano: Plano }).plano;
      const zona = enviado.zonas.find((z) => z.etiqueta === nombreZona);
      const puerta = enviado.elementos.find(
        (e) =>
          e.tipo === "PUERTA" && !original.elementos.some((o) => o.id === e.id),
      );
      expect(zona).toBeDefined();
      expect(puerta).toBeDefined();

      // Recargar: lo que devuelve la API tiene que ser exactamente lo que se
      // guardó (posición, tamaño y rotación).
      const { plano: recargado } = await abrirMapa(page);
      expect(recargado.zonas.find((z) => z.id === zona?.id)).toEqual(zona);
      expect(recargado.elementos.find((e) => e.id === puerta?.id)).toEqual(
        puerta,
      );
      await expect(page.getByText("Cambios sin guardar")).toHaveCount(0);

      // Y se ve en la pantalla: la lista alternativa del plano muestra la zona.
      await page.getByText("Ver el plano como lista").click();
      await expect(
        page.getByText(new RegExp(`^${nombreZona}: \\d+ mesas?$`)),
      ).toBeVisible();
    } finally {
      // Deja el plano como estaba. Va por API (mesas: [] no toca las mesas).
      const restaurar = await page.request.post(`${API_URL}/mesas/layout`, {
        headers: { authorization },
        data: { restauranteId, mesas: [], plano: planoParaGuardar(original) },
      });
      expect(restaurar.ok()).toBe(true);
    }
  });

  test("[TC-E-021] HU-028: el Colaborador ve el plano en modo solo lectura", async ({
    kdsPageMozo: page,
  }) => {
    // GET /mesas/plano responde 200 al MOZO (lo verifica abrirMapa).
    const { plano } = await abrirMapa(page);

    await expect(page.getByText(/modo solo lectura/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Agregar zona" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Guardar mapa" }),
    ).toHaveCount(0);

    // Ve las mismas zonas y elementos que devolvió la API.
    await page.getByText("Ver el plano como lista").click();
    await expect(
      page.getByRole("heading", { name: `Zonas (${plano.zonas.length})` }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: `Elementos fijos (${plano.elementos.length})`,
      }),
    ).toBeVisible();
  });

  test("[TC-E-022] HU-028: el editor del plano no tiene errores críticos de accesibilidad (axe-core)", async ({
    kdsPageAdmin: page,
  }) => {
    await abrirMapa(page);
    // Con la lista abierta, para que axe también la revise.
    await page.getByText("Ver el plano como lista").click();

    // Mismo alcance que TC-E-005 (decisión de equipo del 2026-09-26):
    // WCAG 2.1 AA; solo bloquean las violaciones critical o serious.
    const resultados = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    const violacionesCriticas = resultados.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(violacionesCriticas).toEqual([]);
  });
});
