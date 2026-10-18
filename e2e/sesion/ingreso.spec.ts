import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/auth";

// E2E de BL-342 (BL-351): ingreso en español, con la marca de BistroLink, y
// usuario logueado visible en el encabezado.
//
// - TC-E-023 y TC-E-024 no inician sesión: solo abren /login y el login de
//   Keycloak. Corren en chromium y en desktop-safari (playwright.config.ts).
// - TC-E-025 y TC-E-026 usan las pestañas ya logueadas de support/auth.ts.
//   En WebKit se saltean: el login de Keycloak vuelve a /login después del
//   callback (ver el comentario de qrMesas en support/auth.ts).
//
// ⚠️ Corren contra staging: TC-E-024 necesita el realm de staging con el
// español activado y el tema nuevo desplegado (BL-345).

// Mismo alcance que TC-E-005 y TC-E-022 (decisión de equipo del 2026-09-26):
// WCAG 2.1 AA; solo bloquean las violaciones critical o serious.
async function violacionesGraves(page: Page) {
  const resultados = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return resultados.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
}

/**
 * Llega al login de Keycloak por el mismo camino que support/auth.ts: entra a
 * una pantalla protegida (/kds), la app lo manda a /login?redirect=/kds y ahí
 * se toca «Ingresar». Entrando directo a /login, en WebKit el clic no llegaba
 * a Keycloak; por este camino sí llega (el fixture lo hace en Safari).
 */
async function irAlLoginDeKeycloak(page: Page) {
  await page.goto("/kds");
  await page.waitForURL(/\/login|\/realms\//);
  if (/\/login(?:\?|$)/.test(page.url())) {
    await page.getByRole("button", { name: "Ingresar" }).click();
    await page.waitForURL(/\/realms\//);
  }
}

test.describe("BL-342 · Ingreso en español con la marca de BistroLink", () => {
  test("[TC-E-023] Ingreso: /login muestra la marca y el botón «Ingresar», sin errores graves de accesibilidad", async ({
    page,
  }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("heading", { level: 1, name: "Ingresá a BistroLink" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Volver al inicio" }),
    ).toBeVisible();

    expect(await violacionesGraves(page)).toEqual([]);
  });

  test("[TC-E-024] Ingreso: el login de Keycloak está en español y sin errores graves de accesibilidad", async ({
    page,
  }) => {
    await irAlLoginDeKeycloak(page);

    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(
      page.getByRole("heading", { level: 1, name: "Ingresá a BistroLink" }),
    ).toBeVisible();
    await expect(page.getByLabel("Usuario o correo")).toBeVisible();
    await expect(page.getByLabel("Contraseña", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();

    expect(await violacionesGraves(page)).toEqual([]);
  });

  // Casos con sesión. El skip va a nivel del describe y no dentro del test:
  // así se decide antes de armar los fixtures kdsPageAdmin / kdsPageMozo,
  // que son los que inician sesión (y en WebKit fallan antes de llegar al
  // test).
  test.describe("con sesión iniciada", () => {
    test.skip(
      ({ browserName }) => browserName === "webkit",
      "Login en WebKit: ver el comentario de qrMesas en support/auth.ts",
    );

    test("[TC-E-025] Sesión: el encabezado del KDS muestra el usuario y su rol, y el panel se maneja con teclado", async ({
      kdsPageAdmin: page,
    }) => {
      // locator("header") y no el rol banner: en el admin el <header> está
      // dentro de <main> y ahí no tiene ese rol.
      const usuario = page
        .locator("header")
        .getByRole("button", { name: /Administrador/ });
      await expect(usuario).toBeVisible();
      await expect(usuario).toHaveAttribute("aria-expanded", "false");

      // Se abre con el teclado
      await usuario.focus();
      await page.keyboard.press("Enter");
      await expect(usuario).toHaveAttribute("aria-expanded", "true");
      await expect(
        page.getByRole("button", { name: "Cerrar sesión" }),
      ).toBeVisible();

      // Esc lo cierra y el foco vuelve al botón
      await page.keyboard.press("Escape");
      await expect(usuario).toHaveAttribute("aria-expanded", "false");
      await expect(usuario).toBeFocused();
      await expect(
        page.getByRole("button", { name: "Cerrar sesión" }),
      ).toBeHidden();
    });

    test("[TC-E-026] Sesión: el encabezado del admin muestra el rol del mozo", async ({
      kdsPageMozo: page,
    }) => {
      await page.goto("/admin/mesas");

      await expect(
        page.locator("header").getByRole("button", { name: /Mozo/ }),
      ).toBeVisible();
    });
  });
});
