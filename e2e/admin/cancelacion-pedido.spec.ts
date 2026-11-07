import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, KDS_PATH, MENU_URL_PATH } from "../support/ids";
import { continuarAlPago } from "../support/pago";

// HU-024 (BL-104): el mozo cancela un pedido pagado desde el KDS.
//
// Se paga en efectivo (como TC-E-046) para no depender del sandbox de Mercado
// Pago: la devolución es manual y el mozo la confirma en el diálogo. El
// reembolso por Mercado Pago lo prueban la integración (TC-I-179) y el
// contrato (TC-C-022). Usa la pestaña ya logueada del fixture kdsPageMozo.

const COBROS_PATH = "/admin/cobros";

const codigoDelPedido = (pedidoId: string) =>
  `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

test.describe("BL-104: Cancelación de un pedido pagado", () => {
  test("[TC-E-081] HU-024: el mozo cancela desde el KDS un pedido pagado en efectivo, confirma la devolución, sin errores graves de accesibilidad, y el pedido sale del tablero", async ({
    page,
    kdsPageMozo,
  }) => {
    test.slow();
    // 1. El comensal arma un pedido para retirar.
    await page.goto(MENU_URL_PATH);
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
    await page
      .getByRole("button", {
        name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
      })
      .click();
    const pedidoId = await continuarAlPago(page);
    const codigo = codigoDelPedido(pedidoId);

    // 2. El mozo lo cobra en efectivo: pasa a cocina.
    await kdsPageMozo.goto(COBROS_PATH);
    const fila = kdsPageMozo
      .getByRole("listitem")
      .filter({ hasText: `Pedido ${codigo}` });
    await expect(fila).toBeVisible({ timeout: 15000 });
    await fila.getByRole("button", { name: "Cobrar en efectivo" }).click();
    const cobro = kdsPageMozo.getByRole("dialog");
    await cobro.getByLabel("Monto recibido").fill("99999");
    await cobro.getByRole("button", { name: "Confirmar cobro" }).click();
    await expect(
      kdsPageMozo.getByText(`Cobro registrado: pedido ${codigo}`),
    ).toBeVisible();

    // 3. Desde el KDS, «Cancelar pedido».
    await kdsPageMozo.goto(KDS_PATH);
    const comanda = kdsPageMozo.locator(
      `article[data-pedido-id="${pedidoId}"]`,
    );
    await expect(comanda).toBeVisible({ timeout: 15000 });
    await comanda.getByRole("button", { name: /^Cancelar pedido/ }).click();

    const dialogo = kdsPageMozo.getByRole("dialog");
    await expect(
      dialogo.getByText("Devolvé el efectivo al comensal."),
    ).toBeVisible({
      timeout: 10000,
    });
    await dialogo.getByLabel("Motivo").selectOption("ERROR_PEDIDO");

    const resultados = await new AxeBuilder({ page: kdsPageMozo })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
    ).toEqual([]);

    // Sin confirmar la devolución no cancela.
    await dialogo.getByRole("button", { name: "Cancelar pedido" }).click();
    await expect(
      dialogo.getByText("Confirmá que hiciste la devolución."),
    ).toBeVisible();

    await dialogo.getByLabel("Ya hice la devolución al comensal").check();
    const [respuesta] = await Promise.all([
      kdsPageMozo.waitForResponse(
        (res) =>
          res.url().endsWith(`/pedidos/${pedidoId}/cancelacion`) &&
          res.request().method() === "POST",
      ),
      dialogo.getByRole("button", { name: "Cancelar pedido" }).click(),
    ]);
    expect(respuesta.status()).toBe(201);
    expect(await respuesta.json()).toMatchObject({
      estado: "CANCELADO",
      devoluciones: [{ medio: "EFECTIVO", automatica: false }],
    });

    // 4. Sale del tablero y queda el aviso.
    await expect(comanda).toHaveCount(0, { timeout: 10000 });
    await expect(
      kdsPageMozo.getByText(/cancelado\. Se devolvió con efectivo/),
    ).toBeVisible();
  });
});
