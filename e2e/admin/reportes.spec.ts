import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/auth";

// HU-012 (BL-108): dashboard de reportes del administrador en
// /admin/reportes.
//
// Solo lectura: no cambia datos en staging. No depende de que haya ventas:
// revisa la pantalla, los filtros y los pedidos a la API. Las cuentas y el
// tiempo real se prueban en la integración (reportes.e2e-spec.ts).

const REPORTES_PATH = "/admin/reportes";

/** El chip (label) de un radio: el radio en sí está escondido. */
function chip(page: Page, nombre: string) {
  return page.locator("label", {
    has: page.getByRole("radio", { name: nombre, exact: true }),
  });
}

/** Espera la respuesta de la API de reportes que cumpla `condicion`. */
function respuestaReportes(page: Page, condicion: (url: string) => boolean) {
  return page.waitForResponse(
    (res) =>
      res.url().includes(`${REPORTES_PATH}?`) &&
      res.request().method() === "GET" &&
      condicion(res.url()),
  );
}

test.describe("BL-108: reportes de ventas del administrador", () => {
  test("[TC-E-066] HU-012: el administrador abre Reportes desde el menú, cambia el período y el canal, y la pantalla no tiene errores graves de accesibilidad", async ({
    kdsPageAdmin: page,
  }) => {
    await page.goto("/admin/mesas");
    const [inicial] = await Promise.all([
      respuestaReportes(page, (url) => url.includes("periodo=HOY")),
      page.getByRole("link", { name: "Reportes" }).first().click(),
    ]);
    expect(inicial.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${REPORTES_PATH}$`));
    await expect(
      page.getByRole("heading", { name: "Reportes", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Total vendido" }),
    ).toBeVisible();
    // Cada gráfico tiene su tabla para los lectores de pantalla.
    await expect(
      page.getByRole("table", { name: "Ventas por hora del día" }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("table", { name: "Platos más pedidos" }),
    ).toHaveCount(1);

    // Cambiar el período pide los últimos 7 días.
    const [semana] = await Promise.all([
      respuestaReportes(page, (url) => url.includes("periodo=ULTIMOS_7_DIAS")),
      chip(page, "Últimos 7 días").click(),
    ]);
    expect(semana.status()).toBe(200);
    await expect(
      page.getByRole("radio", { name: "Últimos 7 días", exact: true }),
    ).toBeChecked();

    // Con el canal Web la rotación de mesas no aplica.
    const [web] = await Promise.all([
      respuestaReportes(page, (url) => url.includes("canal=WEB")),
      chip(page, "Web").click(),
    ]);
    expect(web.status()).toBe(200);
    expect(
      ((await web.json()) as { rotacionMesas: unknown }).rotacionMesas,
    ).toEqual({
      aplica: false,
    });
    await expect(page.getByText(/^No aplica\./)).toBeVisible();

    // WhatsApp todavía no recibe pedidos.
    await expect(page.getByRole("radio", { name: /WhatsApp/ })).toBeDisabled();
    await expect(page.getByText("Próximamente").first()).toBeVisible();

    const resultados = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  });

  test("[TC-E-067] HU-012: un período personalizado con «desde» posterior a «hasta» se avisa sin consultar la API", async ({
    kdsPageAdmin: page,
  }) => {
    const pedidos: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes(`${REPORTES_PATH}?`)) pedidos.push(req.url());
    });
    await page.goto(REPORTES_PATH);
    await expect(
      page.getByRole("heading", { name: "Reportes", level: 1 }),
    ).toBeVisible();

    await chip(page, "Personalizado").click();
    await page.getByLabel("Desde").fill("2026-12-31");
    await page.getByLabel("Hasta").fill("2026-01-01");

    await expect(
      page.getByRole("alert").filter({ hasText: /Elegí las dos fechas/ }),
    ).toBeVisible();
    await expect(page.getByLabel("Desde")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(pedidos.some((url) => url.includes("desde=2026-12-31"))).toBe(false);
  });

  test("[TC-E-068] HU-012: el mozo no ve Reportes en el menú y si entra a la ruta vuelve al mapa de mesas", async ({
    kdsPageMozo: page,
  }) => {
    await page.goto("/admin/mesas");
    await expect(
      page.getByRole("link", { name: "Mapa de mesas" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Reportes" })).toHaveCount(0);

    await page.goto(REPORTES_PATH);
    await expect(page).toHaveURL(/\/admin\/mesas$/);
  });
});
