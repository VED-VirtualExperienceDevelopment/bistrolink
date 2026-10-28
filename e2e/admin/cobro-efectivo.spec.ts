import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, KDS_PATH, MENU_URL_PATH } from "../support/ids";
import { intentarEntregarPedido } from "../support/kds";
import { continuarAlPago } from "../support/pago";

// HU-031 (BL-201): el mozo registra un cobro en efectivo.
//
// El comensal arma un pedido para retirar y se queda en «Pagá tu pedido»
// (PENDIENTE_PAGO, no llega a cocina). El mozo lo cobra en efectivo desde
// /admin/cobros y el pedido aparece en el KDS. Se usa la pestaña ya logueada
// del fixture kdsPageMozo: la sesión de Keycloak es la misma, solo se navega.
//
// Al terminar, el pedido se entrega desde el KDS para no dejar tickets
// abiertos en la cocina de staging.

const COBROS_PATH = "/admin/cobros";

/** Mismo código que muestran la pantalla del comensal y la del mozo. */
const codigoDelPedido = (pedidoId: string) =>
  `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

test.describe("BL-201: Cobro en efectivo", () => {
  test("[TC-E-046] HU-031: el mozo cobra en efectivo un pedido para retirar, ve el vuelto y el pedido llega al KDS", async ({
    page,
    kdsPageMozo,
  }) => {
    test.slow();
    let pedidoId: string | undefined;
    try {
      // 1. El comensal confirma el carrito y no paga con tarjeta.
      await page.goto(MENU_URL_PATH);
      await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
      await page
        .getByRole("button", {
          name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
        })
        .click();
      pedidoId = await continuarAlPago(page);
      const codigo = codigoDelPedido(pedidoId);

      // 2. El mozo lo encuentra en «Cobros pendientes».
      await kdsPageMozo.goto(COBROS_PATH);
      await expect(
        kdsPageMozo.getByRole("heading", { name: "Cobros pendientes" }),
      ).toBeVisible({ timeout: 15000 });
      const fila = kdsPageMozo
        .getByRole("listitem")
        .filter({ hasText: `Pedido ${codigo}` });
      await expect(fila).toBeVisible({ timeout: 10000 });
      await fila.getByRole("button", { name: "Cobrar en efectivo" }).click();

      // 3. Ingresa lo recibido y ve el vuelto antes de confirmar.
      const dialogo = kdsPageMozo.getByRole("dialog");
      await expect(dialogo).toBeVisible();
      await dialogo.getByLabel("Monto recibido").fill("99999");
      await expect(dialogo.getByText(/^Vuelto:/)).toBeVisible();

      const [cobroRes] = await Promise.all([
        kdsPageMozo.waitForResponse(
          (res) =>
            res.url().endsWith("/cobros/efectivo") &&
            res.request().method() === "POST",
        ),
        dialogo.getByRole("button", { name: "Confirmar cobro" }).click(),
      ]);
      expect(cobroRes.status()).toBe(201);
      await expect(
        kdsPageMozo.getByText(`Cobro registrado: pedido ${codigo}`),
      ).toBeVisible();
      // Ya no está entre los pendientes.
      await expect(fila).toHaveCount(0, { timeout: 10000 });

      // 4. El pedido llegó a cocina.
      await kdsPageMozo.goto(KDS_PATH);
      await expect(
        kdsPageMozo.getByRole("heading", { name: "Pedidos activos" }),
      ).toBeVisible({ timeout: 15000 });
      await expect(
        kdsPageMozo.locator(`article[data-pedido-id="${pedidoId}"]`),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      await intentarEntregarPedido(kdsPageMozo, pedidoId);
    }
  });
});
