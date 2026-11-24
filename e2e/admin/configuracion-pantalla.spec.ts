import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/auth";

// E2E de BL-473: pantalla de Configuración (/admin/configuracion) responsive,
// accesible y con «Guardar cambios» al final.
//
// Solo lee: abre la pantalla, cambia el tamaño de la ventana y hace scroll.
// No cambia la configuración del establecimiento del seed, así que corre en
// el proyecto `chromium` junto con el resto (no en `chromium-configuracion`).

const CONFIGURACION_PATH = "/admin/configuracion";

async function abrirConfiguracion(page: Page) {
  await page.goto(CONFIGURACION_PATH);
  await expect(
    page.getByRole("form", { name: "Configuración del establecimiento" }),
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

/** Ni la página ni el contenedor del panel tienen scroll horizontal. */
async function sinScrollHorizontal(page: Page) {
  const desbordes = await page.evaluate(() =>
    [document.documentElement, ...document.querySelectorAll("main *")]
      .filter(
        (el) =>
          el === document.documentElement ||
          getComputedStyle(el).overflowY === "auto",
      )
      .map((el) => el.scrollWidth - el.clientWidth)
      .filter((exceso) => exceso > 1),
  );
  expect(desbordes).toEqual([]);
}

test.describe("Configuración: pantalla (BL-473)", () => {
  test("[TC-E-075] Configuración: sin errores graves de accesibilidad y «Guardar cambios» al final, visible al hacer scroll", async ({
    kdsPageAdmin: page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await abrirConfiguracion(page);

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

    // Arriba de todo y después de bajar hasta «Privacidad»: la barra queda
    // fija abajo.
    await guardarAlFinalYVisible(page);
    await page
      .getByRole("heading", { name: "Privacidad" })
      .scrollIntoViewIfNeeded();
    await guardarAlFinalYVisible(page);
  });

  test("[TC-E-076] Configuración: en celular no hay scroll horizontal y «Guardar cambios» queda a mano", async ({
    kdsPageAdmin: page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await abrirConfiguracion(page);

    await sinScrollHorizontal(page);
    await guardarAlFinalYVisible(page);

    await page
      .getByRole("heading", { name: "Anonimizar datos de facturación" })
      .scrollIntoViewIfNeeded();
    await sinScrollHorizontal(page);
    await guardarAlFinalYVisible(page);
  });

  test("[TC-E-116] HU-043: «Marca del local» en un celular de 360 px: sin scroll horizontal, plantillas como botones de opción y fáciles de tocar", async ({
    kdsPageAdmin: page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await abrirConfiguracion(page);

    const marca = page.getByRole("region", { name: "Marca del local" });
    await marca.scrollIntoViewIfNeeded();
    await sinScrollHorizontal(page);

    // Un grupo con nombre y 4 opciones, una elegida.
    const grupo = marca.getByRole("group", { name: "Estilo del menú" });
    await expect(grupo.getByRole("radio")).toHaveCount(4);
    await expect(grupo.getByRole("radio", { checked: true })).toHaveCount(1);

    // Cada tarjeta mide al menos 44 × 44 px (WCAG 2.5.5).
    const tarjetas = grupo.locator("label");
    for (let i = 0; i < (await tarjetas.count()); i++) {
      const caja = await tarjetas.nth(i).boundingBox();
      expect(caja?.width).toBeGreaterThanOrEqual(44);
      expect(caja?.height).toBeGreaterThanOrEqual(44);
    }

    // Sin errores graves de accesibilidad en la sección.
    const resultados = await new AxeBuilder({ page })
      .include("section[aria-labelledby='titulo-marca']")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const graves = resultados.violations
      .filter((v) => v.impact === "critical" || v.impact === "serious")
      .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) }));
    expect(graves).toEqual([]);
  });
});
