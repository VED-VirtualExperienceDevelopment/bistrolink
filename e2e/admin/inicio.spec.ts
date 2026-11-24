import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/auth";

// BL-520: pantalla de Inicio del administrador y del mozo (/admin/inicio).
//
// Solo lectura: no cambia datos en staging y no depende de que haya ventas,
// pedidos o alertas. Revisa a dónde se llega al entrar, qué ve cada rol, que
// una tarjeta que falla no rompe el resto y la accesibilidad.

const INICIO_PATH = "/admin/inicio";
const SALUDO = /^(Buen día|Buenas tardes|Buenas noches)/;

async function violacionesGraves(page: Page) {
  const resultados = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return resultados.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) }));
}

/** Entra por «/», que decide el destino según el rol. */
async function entrar(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`${INICIO_PATH}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: SALUDO }),
  ).toBeVisible();
}

test.describe("BL-520: Inicio del administrador y del mozo", () => {
  test("[TC-E-108] BL-520: el administrador llega a Inicio al entrar y ve el resumen del día, lo pendiente y los accesos rápidos", async ({
    kdsPageAdmin: page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);

    await expect(
      page.getByRole("link", { name: "Inicio", exact: true }).first(),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: "Ventas de hoy" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Mesas con gente" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Necesita tu atención" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Lo más pedido hoy" }),
    ).toBeVisible();

    const accesos = page.getByRole("navigation", { name: "Accesos rápidos" });
    for (const nombre of [
      "Mapa de mesas",
      "KDS",
      "POS del local",
      "Gestión de carta",
    ]) {
      await expect(accesos.getByRole("link", { name: nombre })).toBeVisible();
    }

    // Cada tarjeta lleva a su sección.
    await page.getByRole("link", { name: /Ver reportes/ }).click();
    await expect(page).toHaveURL(/\/admin\/reportes$/);
    await page.goBack();
    await expect(
      page.getByRole("heading", { level: 1, name: SALUDO }),
    ).toBeVisible();

    expect(await violacionesGraves(page)).toEqual([]);
  });

  test("[TC-E-109] BL-520: el mozo llega a Inicio al entrar, ve lo que tiene que hacer y no ve datos de ventas", async ({
    kdsPageMozo: page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await entrar(page);

    for (const titulo of [
      "Te llaman",
      "Listos para llevar",
      "Salón",
      "Cobros pendientes",
      "Agotados hoy",
    ]) {
      await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
    }
    // Sin ventas ni accesos de administrador.
    await expect(
      page.getByRole("heading", { name: "Ventas de hoy" }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Reportes" })).toHaveCount(0);

    expect(await violacionesGraves(page)).toEqual([]);

    await page.getByRole("link", { name: "Ir al mapa de mesas" }).click();
    await expect(page).toHaveURL(/\/admin\/mesas$/);
  });

  test("[TC-E-110] BL-520: si una consulta de Inicio falla, solo esa tarjeta avisa y el resto se ve igual", async ({
    kdsPageMozo: page,
  }) => {
    await page.route("**/cobros/pendientes", (ruta) =>
      ruta.fulfill({ status: 500, body: "{}" }),
    );
    await entrar(page);

    const cobros = page.getByRole("region", { name: "Cobros pendientes" });
    await expect(
      cobros.getByRole("button", { name: "Reintentar" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Salón" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Agotados hoy" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Salón" }).getByRole("button", {
        name: "Reintentar",
      }),
    ).toHaveCount(0);

    // Al volver la API, «Reintentar» recupera la tarjeta.
    await page.unroute("**/cobros/pendientes");
    await cobros.getByRole("button", { name: "Reintentar" }).click();
    await expect(
      cobros.getByRole("button", { name: "Reintentar" }),
    ).toHaveCount(0);
  });

  test("[TC-E-111] BL-520: en el celular, Inicio del mozo se ve en una columna, sin desplazamiento horizontal", async ({
    kdsPageMozo: page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await entrar(page);

    await expect(
      page.getByRole("heading", { name: "Te llaman" }),
    ).toBeVisible();
    // El contenido scrollea adentro de AdminShell: se mide ese contenedor.
    const desborde = await page
      .getByRole("heading", { level: 1, name: SALUDO })
      .evaluate((titulo) => {
        const contenedor = titulo.closest(".overflow-y-auto") ?? document.body;
        return contenedor.scrollWidth - contenedor.clientWidth;
      });
    expect(desborde).toBeLessThanOrEqual(0);
    await expect(
      page.getByRole("link", { name: "Ir al mapa de mesas" }),
    ).toBeVisible();
  });
});
