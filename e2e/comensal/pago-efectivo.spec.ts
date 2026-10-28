import { test, expect } from "../support/auth";
import {
  ITEM_DISPONIBLE,
  KDS_PATH,
  MENU_URL_PATH,
  MESA_ID,
} from "../support/ids";
import { intentarEntregarPedido } from "../support/kds";
import { continuarAlPago } from "../support/pago";

// HU-031b (BL-442): el comensal elige pagar en efectivo.
//
// - En la mesa (dentro del local), el comensal elige «Efectivo», dice con
//   cuánto paga y avisa al mozo. El mozo ve el pedido marcado en «Cobros
//   pendientes», lo cobra (el monto ya viene cargado) y la pantalla del
//   comensal pasa sola a «¡Tu pedido ya está en cocina!».
// - Desde la carta web (fuera del local), la opción «Efectivo» no existe.
//
// Necesita el efectivo habilitado en el establecimiento del seed (es el
// valor por defecto). El pedido se entrega desde el KDS al terminar.

const COBROS_PATH = "/admin/cobros";

const codigoDelPedido = (pedidoId: string) =>
  `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

test.describe("BL-442: Pago en efectivo del comensal", () => {
  test("[TC-E-047] HU-031b: el comensal en la mesa elige efectivo, el mozo lo ve marcado, lo cobra y el pedido pasa a cocina", async ({
    page,
    kdsPageMozo,
    qrMesas,
  }) => {
    test.slow();
    let pedidoId: string | undefined;
    try {
      // 1. El comensal arma el pedido desde el QR de la mesa.
      await page.goto(qrMesas.ruta(MESA_ID));
      await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
      await page
        .getByRole("button", {
          name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
        })
        .click();
      pedidoId = await continuarAlPago(page);
      const codigo = codigoDelPedido(pedidoId);

      // 2. Elige efectivo, dice con cuánto paga y avisa al mozo.
      const efectivo = page.getByRole("radio", { name: /Efectivo/ });
      await expect(efectivo).toBeVisible({ timeout: 10000 });
      await efectivo.check();
      await page.getByLabel("¿Con cuánto vas a pagar?").fill("10000");
      const [solicitud] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res
              .url()
              .endsWith(`/pedidos/${pedidoId}/pagos/solicitud-efectivo`) &&
            res.request().method() === "POST",
        ),
        page.getByRole("button", { name: "Avisar al mozo" }).click(),
      ]);
      expect(solicitud.status()).toBe(200);
      await expect(
        page.getByRole("heading", { name: "Esperando al mozo" }),
      ).toBeVisible();

      // 3. El mozo lo ve marcado en «Cobros pendientes» y lo cobra.
      await kdsPageMozo.goto(COBROS_PATH);
      const fila = kdsPageMozo
        .getByRole("listitem")
        .filter({ hasText: `Pedido ${codigo}` });
      await expect(fila).toBeVisible({ timeout: 15000 });
      await expect(fila).toContainText("Pidió pagar en efectivo");
      await fila.getByRole("button", { name: "Cobrar en efectivo" }).click();

      const dialogo = kdsPageMozo.getByRole("dialog");
      // El monto que dijo el comensal ya viene cargado.
      await expect(dialogo.getByLabel("Monto recibido")).toHaveValue(
        "10000.00",
      );
      const [cobro] = await Promise.all([
        kdsPageMozo.waitForResponse(
          (res) =>
            res.url().endsWith("/cobros/efectivo") &&
            res.request().method() === "POST",
        ),
        dialogo.getByRole("button", { name: "Confirmar cobro" }).click(),
      ]);
      expect(cobro.status()).toBe(201);

      // 4. La pantalla del comensal se actualiza sola.
      await expect(
        page.getByRole("heading", { name: "¡Tu pedido ya está en cocina!" }),
      ).toBeVisible({ timeout: 20000 });
    } finally {
      await kdsPageMozo.goto(KDS_PATH).catch(() => undefined);
      await intentarEntregarPedido(kdsPageMozo, pedidoId);
    }
  });

  test("[TC-E-048] HU-031b: desde la carta web (fuera del local) no aparece la opción de pagar en efectivo", async ({
    page,
  }) => {
    await page.goto(MENU_URL_PATH);
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
    await page
      .getByRole("button", {
        name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
      })
      .click();
    await continuarAlPago(page);

    // Solo tarjeta: el formulario está y no hay opciones de pago.
    await expect(
      page.getByRole("heading", { name: "Tarjeta de débito o crédito" }),
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: /Efectivo/ })).toHaveCount(0);
    await expect(page.getByText("Avisar al mozo")).toHaveCount(0);
  });
});
