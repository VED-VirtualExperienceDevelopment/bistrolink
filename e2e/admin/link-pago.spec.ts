import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MENU_URL_PATH } from "../support/ids";
import { continuarAlPago } from "../support/pago";

// HU-033 (BL-203): el mozo genera un link de pago para un pedido pendiente y
// el comensal lo abre en su celular.
//
// El comensal arma un pedido para retirar y se queda en «Pagá tu pedido»
// (PENDIENTE_PAGO), igual que TC-E-080. El mozo genera el link desde
// /admin/cobros y el link se abre en otro navegador (el celular del
// comensal). No se paga: la aprobación con la pasarela la cubre la
// integración (TC-I-210); acá se prueba lo que ven el mozo y el comensal.
//
// BL-477: al terminar, el pedido lo cierra el fixture pedidosDeTest.

const COBROS_PATH = "/admin/cobros";

const codigoDelPedido = (pedidoId: string) =>
  `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

/** El comensal deja un pedido esperando el pago; devuelve su código. */
async function pedidoPendiente(page: Page): Promise<string> {
  await page.goto(MENU_URL_PATH);
  await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
  await page
    .getByRole("button", {
      name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
    })
    .click();
  return codigoDelPedido(await continuarAlPago(page));
}

/** Abre «Link de pago» del pedido en /admin/cobros y devuelve el diálogo. */
async function abrirLinkDePago(mozo: Page, codigo: string) {
  await mozo.goto(COBROS_PATH);
  await expect(
    mozo.getByRole("heading", { name: "Cobros pendientes" }),
  ).toBeVisible({ timeout: 15000 });
  const fila = mozo
    .getByRole("listitem")
    .filter({ hasText: `Pedido ${codigo}` });
  await expect(fila).toBeVisible({ timeout: 10000 });
  await fila.getByRole("button", { name: "Link de pago" }).click();
  const dialogo = mozo.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  return { fila, dialogo };
}

test.describe("BL-203: Pago por link", () => {
  test("[TC-E-112] HU-033: el mozo genera el link de pago (QR y URL, sin errores graves de accesibilidad) y el comensal lo abre en su celular para pagar con tarjeta", async ({
    page,
    kdsPageMozo,
    browser,
  }) => {
    test.slow();
    const codigo = await pedidoPendiente(page);

    // 1. El mozo genera el link: QR, URL para copiar y vencimiento.
    const { fila, dialogo } = await abrirLinkDePago(kdsPageMozo, codigo);
    await expect(
      dialogo.getByRole("img", {
        name: `QR del link de pago del pedido ${codigo}`,
      }),
    ).toBeVisible({ timeout: 10000 });
    const url = await dialogo.getByLabel("Link para copiar").inputValue();
    expect(url).toMatch(/\/pagar\/[A-Za-z0-9_-]{103}$/);
    await expect(dialogo.getByText(/^Vence a las \d{2}:\d{2}/)).toBeVisible();

    const resultados = await new AxeBuilder({ page: kdsPageMozo })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
    ).toEqual([]);

    await dialogo.getByRole("button", { name: "Listo" }).click();
    await expect(
      fila.getByText(/^Link de pago activo hasta las/),
    ).toBeVisible();

    // 2. El comensal lo abre en su celular: el pedido y solo la tarjeta.
    const celular = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    try {
      await celular.goto(url);
      await expect(
        celular.getByRole("heading", { name: "Pagá tu pedido" }),
      ).toBeVisible({ timeout: 20000 });
      // En el celular «Tu pedido» arranca plegado (ResumenPedido de
      // PagoPedido.tsx): el detalle recién se ve al tocar el encabezado.
      const resumen = celular.getByRole("button", { name: /^Tu pedido/ });
      await expect(resumen).toHaveAttribute("aria-expanded", "false");
      await resumen.click();
      await expect(resumen).toHaveAttribute("aria-expanded", "true");
      await expect(celular.getByText(ITEM_DISPONIBLE)).toBeVisible();
      await expect(
        celular.getByRole("heading", { name: "Tarjeta de débito o crédito" }),
      ).toBeVisible();
      await expect(
        celular.getByRole("button", { name: "Volver a la carta" }),
      ).toHaveCount(0);
      // Por el link no se ofrece el efectivo (para eso está el mozo).
      await expect(
        celular.getByRole("radio", { name: /efectivo/i }),
      ).toHaveCount(0);
    } finally {
      await celular.close();
    }
  });

  test("[TC-E-113] HU-033: generar otro link invalida el anterior: el comensal ve que fue reemplazado", async ({
    page,
    kdsPageMozo,
    browser,
  }) => {
    test.slow();
    const codigo = await pedidoPendiente(page);

    const primero = await abrirLinkDePago(kdsPageMozo, codigo);
    const urlVieja = await primero.dialogo
      .getByLabel("Link para copiar")
      .inputValue();
    await primero.dialogo.getByRole("button", { name: "Listo" }).click();

    // Con un link activo, pide confirmar antes de reemplazarlo.
    const segundo = await abrirLinkDePago(kdsPageMozo, codigo);
    await expect(
      segundo.dialogo.getByText(/Si generás otro, el anterior deja de servir/),
    ).toBeVisible();
    await segundo.dialogo
      .getByRole("button", { name: "Generar otro link" })
      .click();
    const urlNueva = await segundo.dialogo
      .getByLabel("Link para copiar")
      .inputValue();
    expect(urlNueva).not.toBe(urlVieja);

    const celular = await browser.newPage();
    try {
      await celular.goto(urlVieja);
      await expect(
        celular.getByText("Este link de pago fue reemplazado."),
      ).toBeVisible({ timeout: 20000 });
      await celular.goto(urlNueva);
      await expect(
        celular.getByRole("heading", { name: "Pagá tu pedido" }),
      ).toBeVisible({ timeout: 20000 });
    } finally {
      await celular.close();
    }
  });

  test("[TC-E-130] BL-602: en una PC el link de pago usa todo el ancho: la columna del pago y el resumen a la derecha, alineados con el encabezado", async ({
    page,
    kdsPageMozo,
    browser,
  }) => {
    test.slow();
    const codigo = await pedidoPendiente(page);
    const { dialogo } = await abrirLinkDePago(kdsPageMozo, codigo);
    const url = await dialogo.getByLabel("Link para copiar").inputValue();
    await dialogo.getByRole("button", { name: "Listo" }).click();

    // Un contexto propio: axe (AxeBuilder) no acepta páginas abiertas con
    // browser.newPage().
    const contextoPc = await browser.newContext({
      viewport: { width: 1366, height: 900 },
    });
    const pc = await contextoPc.newPage();
    try {
      await pc.goto(url);
      const titulo = pc.getByRole("heading", { name: "Pagá tu pedido" });
      await expect(titulo).toBeVisible({ timeout: 20000 });

      // Antes de BL-602 la columna del pago quedaba en ~250 px y el título
      // se partía en dos líneas.
      const tarjeta = titulo.locator("xpath=ancestor::section[1]");
      const cajaTarjeta = await tarjeta.boundingBox();
      const cajaTitulo = await titulo.boundingBox();
      const resumen = pc.locator('aside[aria-labelledby="resumen-pedido"]');
      const cajaResumen = await resumen.boundingBox();
      // Donde empieza el texto del nombre del local (sin su padding).
      const inicioLocal = await pc
        .locator("header p")
        .first()
        .evaluate(
          (el) =>
            el.getBoundingClientRect().left +
            Number.parseFloat(getComputedStyle(el).paddingLeft),
        );
      expect(cajaTarjeta && cajaTitulo && cajaResumen).toBeTruthy();

      expect(cajaTarjeta!.width).toBeGreaterThan(500);
      // Una sola línea (el título mide ~40 px de alto).
      expect(cajaTitulo!.height).toBeLessThan(60);
      // El resumen, a la derecha de la columna del pago.
      expect(cajaResumen!.x).toBeGreaterThan(
        cajaTarjeta!.x + cajaTarjeta!.width,
      );
      // El nombre del local, alineado con el contenido.
      expect(Math.abs(inicioLocal - cajaTarjeta!.x)).toBeLessThanOrEqual(2);
      // Sin scroll horizontal.
      expect(
        await pc.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);

      const resultados = await new AxeBuilder({ page: pc })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        resultados.violations
          .filter((v) => v.impact === "critical" || v.impact === "serious")
          .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
    } finally {
      await contextoPc.close();
    }
  });
});
