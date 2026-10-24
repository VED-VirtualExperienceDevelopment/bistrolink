import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MENU_URL_PATH } from "../support/ids";
import { intentarEntregarPedido } from "../support/kds";
import { continuarAlPago, pagarConTarjetaDePrueba } from "../support/pago";

// BL-311 (HU-007): prepago (RD.03). Un pago rechazado no cobra, no manda el
// pedido a cocina y deja reintentar con el MISMO pedido (no se crea otro).
// Tarjeta de prueba del sandbox de Mercado Pago: el titular FUND rechaza por
// fondos insuficientes y APRO aprueba (ver support/pago.ts).

test.describe("BL-311: Pago del comensal", () => {
  test("[TC-E-039] HU-007: pago rechazado no llega a cocina; el reintento aprobado sí, con el mismo pedido", async ({
    page,
    kdsPageMozo,
  }) => {
    // Dos pagos contra el sandbox más el login del KDS: no entra en los 30 s
    // por defecto (el login del fixture ya consume parte de ese tiempo).
    test.slow();
    let pedidoId: string | undefined;
    try {
      await page.goto(MENU_URL_PATH);
      await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
      await page
        .getByRole("button", {
          name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
        })
        .click();
      pedidoId = await continuarAlPago(page);

      // 1. Rechazo: no hubo cargo y el pedido sigue guardado.
      expect(await pagarConTarjetaDePrueba(page, "FUND")).toBe(402);
      await expect(
        page.getByRole("heading", { name: "No se pudo completar el cobro" }),
      ).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(/no se realizó ningún cargo/i).first()).toBeVisible();

      // 2. El pedido NO está en cocina (PENDIENTE_PAGO no entra al KDS).
      await kdsPageMozo.reload();
      await expect(
        kdsPageMozo.getByRole("heading", { name: "Pedidos activos" }),
      ).toBeVisible({ timeout: 10000 });
      await expect(
        kdsPageMozo.locator(`article[data-pedido-id="${pedidoId}"]`),
      ).toHaveCount(0);

      // 3. Reintento aprobado sobre el MISMO pedido: no se crea uno nuevo.
      let pedidosCreados = 0;
      page.on("request", (req) => {
        if (req.url().endsWith("/pedidos") && req.method() === "POST") {
          pedidosCreados++;
        }
      });
      expect(await pagarConTarjetaDePrueba(page, "APRO")).toBe(201);
      await expect(
        page.getByRole("heading", { name: "¡Tu pedido ya está en cocina!" }),
      ).toBeVisible({ timeout: 15000 });
      expect(pedidosCreados).toBe(0);

      // 4. Ahora sí llega a cocina (en vivo, sin recargar el KDS).
      await expect(
        kdsPageMozo.locator(`article[data-pedido-id="${pedidoId}"]`),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      await intentarEntregarPedido(kdsPageMozo, pedidoId);
    }
  });
});
