import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, KDS_PATH, MESA_ID } from "../support/ids";
import { continuarAlPago } from "../support/pago";
import { entregarPedidoDesdeKds } from "../support/kds";
import type { QrMesas } from "../support/qr-mesas";

// BL-502: «Mis pedidos» del comensal en la mesa y «Gracias por tu compra».
//
// El pago es en efectivo, cobrado por el mozo (como TC-E-047), para no
// depender del sandbox de Mercado Pago. BL-477: los pedidos los cierra el
// fixture pedidosDeTest.

const COBROS_PATH = "/admin/cobros";

const codigoDelPedido = (pedidoId: string) =>
  `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

/**
 * El acceso a «Mis pedidos» que se ve: la barra de abajo en el celular o el
 * botón de la barra superior en escritorio (lg). El aria-label lleva la
 * cantidad y el resumen («Mis pedidos: 1. 1 en preparación»).
 */
const accesoMisPedidos = (page: Page) =>
  page.locator('button[aria-label^="Mis pedidos:"]:visible').first();

/** El comensal pide desde el QR de la mesa y el mozo lo cobra en efectivo. */
async function pedidoPagadoEnEfectivo(
  page: Page,
  mozo: Page,
  qrMesas: QrMesas,
): Promise<string> {
  await page.goto(qrMesas.ruta(MESA_ID));
  await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
  await page
    .getByRole("button", {
      name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
    })
    .click();
  const pedidoId = await continuarAlPago(page);

  const efectivo = page.getByRole("radio", { name: /Efectivo/ });
  await expect(efectivo).toBeVisible({ timeout: 10000 });
  await efectivo.check();
  await page.getByLabel("¿Con cuánto vas a pagar?").fill("10000");
  await page.getByRole("button", { name: "Avisar al mozo" }).click();
  await expect(
    page.getByRole("heading", { name: "Esperando al mozo" }),
  ).toBeVisible();

  await mozo.goto(COBROS_PATH);
  const fila = mozo
    .getByRole("listitem")
    .filter({ hasText: `Pedido ${codigoDelPedido(pedidoId)}` });
  await expect(fila).toBeVisible({ timeout: 15000 });
  await fila.getByRole("button", { name: "Cobrar en efectivo" }).click();
  await mozo
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar cobro" })
    .click();

  await expect(
    page.getByRole("heading", { name: "¡Tu pedido ya está en cocina!" }),
  ).toBeVisible({ timeout: 20000 });
  return pedidoId;
}

test.describe("BL-502: Mis pedidos en la mesa", () => {
  test("[TC-E-102] BL-502: después de pagar y hacer otro pedido, y al volver a escanear el QR en otra pestaña, el comensal sigue viendo su pedido en «Mis pedidos» con el estado en vivo", async ({
    page,
    kdsPageMozo,
    qrMesas,
  }) => {
    test.slow();
    const pedidoId = await pedidoPagadoEnEfectivo(page, kdsPageMozo, qrMesas);
    const codigo = codigoDelPedido(pedidoId);

    // 1. «Hacer otro pedido»: vuelve a la carta y el pedido sigue ahí.
    await page.getByRole("button", { name: "Hacer otro pedido" }).click();
    const acceso = accesoMisPedidos(page);
    await expect(acceso).toBeVisible({ timeout: 10000 });
    await acceso.click();
    const panel = page.getByTestId("mis-pedidos-panel");
    const tarjeta = panel.locator(`li[data-pedido-id="${pedidoId}"]`);
    await expect(tarjeta).toContainText(codigo);
    await expect(tarjeta.getByTestId("estado-pedido-mesa")).toHaveText(
      "Recibido",
    );

    // 2. El mozo lo pasa a preparación: se ve sin recargar.
    await kdsPageMozo.goto(KDS_PATH);
    await kdsPageMozo
      .locator(`article[data-pedido-id="${pedidoId}"]`)
      .getByRole("button", { name: "Marcar en preparación" })
      .click();
    await expect(tarjeta.getByTestId("estado-pedido-mesa")).toHaveText(
      "En preparación",
      { timeout: 10000 },
    );
    await panel.getByRole("button", { name: "Cerrar mis pedidos" }).click();
    await expect(panel).toBeHidden();

    // 3. Vuelve a escanear el QR: el teléfono abre otra pestaña.
    const otraPestania = await page.context().newPage();
    await otraPestania.goto(qrMesas.ruta(MESA_ID));
    const accesoNuevo = accesoMisPedidos(otraPestania);
    await expect(accesoNuevo).toHaveAttribute(
      "aria-label",
      /1 en preparación/,
      { timeout: 10000 },
    );
    await accesoNuevo.click();
    await expect(
      otraPestania
        .getByTestId("mis-pedidos-panel")
        .locator(`li[data-pedido-id="${pedidoId}"]`),
    ).toContainText(codigo);

    const resultados = await new AxeBuilder({ page: otraPestania })
      .include('[data-testid="mis-pedidos-panel"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
    await otraPestania.close();
  });

  test("[TC-E-103] BL-502: cuando el mozo entrega el pedido, el comensal ve «Gracias por tu compra» sin recargar, sin errores graves de accesibilidad, y puede pedir algo más", async ({
    page,
    kdsPageMozo,
    qrMesas,
  }) => {
    test.slow();
    const pedidoId = await pedidoPagadoEnEfectivo(page, kdsPageMozo, qrMesas);

    await kdsPageMozo.goto(KDS_PATH);
    await entregarPedidoDesdeKds(kdsPageMozo, pedidoId);

    const gracias = page.getByTestId("gracias-por-tu-compra");
    await expect(
      gracias.getByRole("heading", { name: "Gracias por tu compra" }),
    ).toBeVisible({ timeout: 10000 });
    await expect(gracias).toContainText(
      `Pedido ${codigoDelPedido(pedidoId)} entregado`,
    );
    await expect(gracias).toContainText(ITEM_DISPONIBLE);
    await expect(gracias).toContainText("Total abonado");

    const resultados = await new AxeBuilder({ page })
      .include('[data-testid="gracias-por-tu-compra"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
    ).toEqual([]);

    await gracias.getByRole("button", { name: "Pedir algo más" }).click();
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
    await expect(accesoMisPedidos(page)).toHaveAttribute(
      "aria-label",
      /Todo entregado/,
      { timeout: 10000 },
    );
  });
});
