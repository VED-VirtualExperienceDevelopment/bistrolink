import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, KDS_PATH, MESA_ID } from "../support/ids";
import { intentarEntregarPedido } from "../support/kds";

// HU-039 (BL-209): el mozo carga el pedido de un comensal sin celular.
//
// El mozo abre la pantalla de carga de una mesa abierta, arma el pedido, lo
// cobra en efectivo (BL-201) y el pedido aparece en el KDS. La mesa del seed
// la deja abierta el fixture qrMesas (BL-432). Al terminar, el pedido se
// entrega desde el KDS para no dejar tickets abiertos en staging.

test.describe("BL-209: Pedido cargado por el mozo", () => {
  test("[TC-E-049] HU-039: el mozo carga el pedido de una mesa, lo cobra en efectivo y aparece en el KDS", async ({
    kdsPageMozo,
    qrMesas,
  }) => {
    test.slow();
    // El fixture deja la mesa del seed abierta (sesión, HU-017).
    expect(qrMesas.ruta(MESA_ID)).toBeTruthy();
    const pagina = kdsPageMozo;
    let pedidoId: string | undefined;
    try {
      // 1. Arma el pedido con la carta.
      await pagina.goto(`/admin/mesas/pedido?mesa=${MESA_ID}`);
      await pagina
        .getByRole("button", {
          name: `Agregar una unidad de ${ITEM_DISPONIBLE}`,
        })
        .click();
      await pagina
        .getByLabel(`Nota para ${ITEM_DISPONIBLE}`)
        .fill("Sin sal (E2E)");

      const [pedidoRes] = await Promise.all([
        pagina.waitForResponse(
          (res) =>
            res.url().endsWith("/pedidos/mozo") &&
            res.request().method() === "POST",
        ),
        pagina.getByRole("button", { name: "Confirmar pedido" }).click(),
      ]);
      expect(pedidoRes.status()).toBe(201);
      const pedido = (await pedidoRes.json()) as { id: string; canal: string };
      pedidoId = pedido.id;
      expect(pedido.canal).toBe("MOZO");

      // 2. Lo cobra en efectivo ahí mismo.
      await pagina.getByRole("button", { name: "Cobrar en efectivo" }).click();
      const dialogo = pagina.getByRole("dialog");
      await dialogo.getByLabel("Monto recibido").fill("99999");
      const [cobroRes] = await Promise.all([
        pagina.waitForResponse(
          (res) =>
            res.url().endsWith("/cobros/efectivo") &&
            res.request().method() === "POST",
        ),
        dialogo.getByRole("button", { name: "Confirmar cobro" }).click(),
      ]);
      expect(cobroRes.status()).toBe(201);
      await expect(pagina.getByText(/^Cobro registrado/)).toBeVisible();

      // 3. El pedido llegó a cocina.
      await pagina.goto(KDS_PATH);
      await expect(
        pagina.getByRole("heading", { name: "Pedidos activos" }),
      ).toBeVisible({ timeout: 15000 });
      await expect(
        pagina.locator(`article[data-pedido-id="${pedidoId}"]`),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      await pagina.goto(KDS_PATH).catch(() => undefined);
      await intentarEntregarPedido(pagina, pedidoId);
    }
  });
});
