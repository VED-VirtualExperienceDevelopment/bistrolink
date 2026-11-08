import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

// E2E de BL-352 (BL-355): la landing pública («/» sin sesión) a todo el
// ancho y adaptada a celular, tablet y PC.
//
// No inicia sesión: corre en chromium, en los proyectos de celular
// (mobile-chrome y mobile-safari) y en desktop-safari (playwright.config.ts).
// Los casos que dependen del ancho fijan el tamaño de la ventana, así dan lo
// mismo en cualquier proyecto.

// El título del hero es el lema; la marca va en el encabezado.
const TITULO = { level: 1, name: /Pedí y pagá desde la mesa/ } as const;

/**
 * Abre la landing y espera a que se vea. Mientras keycloak-js revisa si hay
 * sesión (check-sso), «/» muestra un spinner; en WebKit esa revisión puede
 * tardar más de los 5 s por defecto de expect, por eso el margen de 15 s.
 */
async function abrirLanding(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", TITULO)).toBeVisible({
    timeout: 15000,
  });
}

test.describe("BL-352 · Landing pública a todo el ancho", () => {
  test("[TC-E-027] Landing: «Ingresar» está en el encabezado y lleva a /login", async ({
    page,
  }) => {
    await abrirLanding(page);

    const ingresar = page
      .getByRole("banner")
      .getByRole("link", { name: "Ingresar" });
    await expect(ingresar).toBeVisible();

    // Sigue visible después de desplazarse hasta el final (encabezado fijo).
    await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
    await expect(ingresar).toBeInViewport();

    await ingresar.click();
    await page.waitForURL(/\/login/);
  });

  test("[TC-E-028] Landing: en un celular de 360 px no hay scroll horizontal", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await abrirLanding(page);

    const desborda = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(desborda).toBe(false);
  });

  test("[TC-E-029] Landing: desde 1024 px el hero va en dos columnas", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await abrirLanding(page);

    const titulo = page.getByRole("heading", TITULO);
    const panel = page.getByText("Buscá el código QR de tu mesa", {
      exact: true,
    });
    await expect(titulo).toBeVisible();
    await expect(panel).toBeVisible();

    // El panel de la marca queda a la derecha del título, no debajo.
    const cajaTitulo = await titulo.boundingBox();
    const cajaPanel = await panel.boundingBox();
    expect(cajaTitulo).not.toBeNull();
    expect(cajaPanel).not.toBeNull();
    expect(cajaPanel!.x).toBeGreaterThan(cajaTitulo!.x + cajaTitulo!.width);
  });

  test("[TC-E-030] Landing: sin errores graves de accesibilidad (axe-core)", async ({
    page,
  }) => {
    await abrirLanding(page);

    // Mismo alcance que TC-E-005 (decisión de equipo del 2026-09-26):
    // WCAG 2.1 AA; solo bloquean las violaciones critical o serious.
    const resultados = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const graves = resultados.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(graves).toEqual([]);
  });
});
