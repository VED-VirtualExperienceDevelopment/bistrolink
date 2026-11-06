import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/auth";

// E2E de BL-474: pantalla «Stock de la jornada» (/admin/stock) responsive,
// accesible y con «Guardar cambios» al final.
//
// Solo lee: abre la pantalla, cambia el tamaño de la ventana y hace scroll.
// No cambia el stock de ningún ítem, así que corre en el proyecto
// `chromium` y no necesita crear datos propios (usa la carta del seed).

const STOCK_PATH = "/admin/stock";

async function abrirStock(page: Page) {
  await page.goto(STOCK_PATH);
  await expect(
    page.getByRole("form", { name: "Stock de la jornada por ítem" }),
  ).toBeVisible();
}

/** «Guardar cambios» es el último botón del panel y se ve en pantalla. */
async function guardarAlFinalYVisible(page: Page) {
  const botones = page.locator("main").getByRole("button");
  await expect(botones.last()).toHaveText("Guardar cambios");
  await expect(
    page.getByRole("button", { name: "Guardar cambios" }),
  ).toBeInViewport();
}

/** Baja hasta el título de la última categoría. */
async function bajarHastaLaUltimaCategoria(page: Page) {
  await page
    .getByRole("form", { name: "Stock de la jornada por ítem" })
    .getByRole("heading", { level: 2 })
    .last()
    .scrollIntoViewIfNeeded();
}

/**
 * Ni la página ni los contenedores con scroll del panel (el del panel y el
 * de cada tabla) tienen scroll horizontal.
 */
async function sinScrollHorizontal(page: Page) {
  const desbordes = await page.evaluate(() =>
    [document.documentElement, ...document.querySelectorAll("main *")]
      .filter((el) => {
        if (el === document.documentElement) return true;
        const estilo = getComputedStyle(el);
        return estilo.overflowY === "auto" || estilo.overflowX === "auto";
      })
      .map((el) => el.scrollWidth - el.clientWidth)
      .filter((exceso) => exceso > 1),
  );
  expect(desbordes).toEqual([]);
}

test.describe("Stock de la jornada: pantalla (BL-474)", () => {
  test("[TC-E-077] Stock: sin errores graves de accesibilidad y «Guardar cambios» al final, visible al hacer scroll", async ({
    kdsPageAdmin: page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await abrirStock(page);

    // Mismo alcance que TC-E-038 (decisión de equipo del 2026-09-26):
    // WCAG 2.1 AA; solo bloquean las violaciones critical o serious.
    const resultados = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const graves = resultados.violations
      .filter((v) => v.impact === "critical" || v.impact === "serious")
      .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) }));
    expect(graves).toEqual([]);

    // Arriba de todo y después de bajar hasta la última categoría: la barra
    // queda fija abajo.
    await guardarAlFinalYVisible(page);
    await bajarHastaLaUltimaCategoria(page);
    await guardarAlFinalYVisible(page);
  });

  test("[TC-E-078] Stock: en celular no hay scroll horizontal y «Guardar cambios» queda a mano", async ({
    kdsPageAdmin: page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await abrirStock(page);

    await sinScrollHorizontal(page);
    await guardarAlFinalYVisible(page);

    await bajarHastaLaUltimaCategoria(page);
    await sinScrollHorizontal(page);
    await guardarAlFinalYVisible(page);
  });
});
