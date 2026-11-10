import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MESA_ID } from "../support/ids";
import { continuarAlPago } from "../support/pago";

// BL-470: en el aviso de pago en efectivo de las alertas, «Ir a cobrar»
// marca el aviso como atendido y lleva a «Cobros pendientes» con el pedido
// destacado y el foco en «Cobrar en efectivo». El diálogo no se abre solo.
//
// El comensal dice que paga con un monto poco común: así el test encuentra
// su aviso aunque haya otros de otros specs. BL-477: el pedido lo cierra al
// terminar el fixture pedidosDeTest.

const COBROS_PATH = "/admin/cobros";
const PAGA_CON = "9876";

const codigoDelPedido = (pedidoId: string) =>
  `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

test.describe("BL-470: «Ir a cobrar» desde las alertas", () => {
  test("[TC-E-098] el mozo toca «Ir a cobrar» en el aviso de efectivo y llega a Cobros pendientes con el pedido destacado y el foco en «Cobrar en efectivo»", async ({
    page,
    kdsPageMozo,
    qrMesas,
  }) => {
    test.slow();
    // 1. El comensal arma el pedido y avisa que paga en efectivo.
    await page.goto(qrMesas.ruta(MESA_ID));
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
    await page
      .getByRole("button", {
        name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
      })
      .click();
    const pedidoId = await continuarAlPago(page);
    const codigo = codigoDelPedido(pedidoId);

    await kdsPageMozo.goto("/admin/mesas");

    const efectivo = page.getByRole("radio", { name: /Efectivo/ });
    await expect(efectivo).toBeVisible({ timeout: 10000 });
    await efectivo.check();
    await page.getByLabel("¿Con cuánto vas a pagar?").fill(PAGA_CON);
    await page.getByRole("button", { name: "Avisar al mozo" }).click();
    await expect(
      page.getByRole("heading", { name: "Esperando al mozo" }),
    ).toBeVisible();

    // 2. El aviso llega a la campana, con «Ir a cobrar» y «Desestimar».
    const campana = kdsPageMozo
      .locator("main > header")
      .getByRole("button", { name: /^Alertas, \d+ pendientes?$/ });
    await expect(campana).toBeVisible({ timeout: 15000 });
    await campana.click();
    const aviso = kdsPageMozo
      .getByRole("region", { name: "Alertas pendientes" })
      .getByRole("listitem")
      .filter({ hasText: "quiere pagar en efectivo" })
      .filter({ hasText: /paga con \$\s?9\.876/ });
    await expect(aviso).toBeVisible({ timeout: 15000 });
    await expect(
      aviso.getByRole("button", { name: /^Aceptar/ }),
    ).toHaveCount(0);
    await expect(
      aviso.getByRole("button", { name: /^Desestimar la alerta de la mesa/ }),
    ).toBeVisible();

    // 3. «Ir a cobrar»: lleva a Cobros pendientes con el pedido en la URL.
    await aviso
      .getByRole("button", { name: /^Ir a cobrar la mesa \d+$/ })
      .click();
    await expect(kdsPageMozo).toHaveURL(
      new RegExp(`${COBROS_PATH}\\?pedido=${pedidoId}$`),
    );

    // 4. La fila está destacada con texto, se anuncia y tiene el foco.
    const fila = kdsPageMozo
      .getByRole("listitem")
      .filter({ hasText: `Pedido ${codigo}` });
    await expect(fila).toBeVisible({ timeout: 15000 });
    await expect(fila).toContainText("Aviso de efectivo");
    await expect(
      kdsPageMozo.getByRole("status").filter({
        hasText: new RegExp(`Pedido ${codigo} de la mesa \\d+, esperando cobro\\.`),
      }),
    ).toBeVisible();
    await expect(
      fila.getByRole("button", { name: "Cobrar en efectivo" }),
    ).toBeFocused();

    // El diálogo de cobro no se abre solo.
    await expect(kdsPageMozo.getByRole("dialog")).toHaveCount(0);

    const resultados = await new AxeBuilder({ page: kdsPageMozo })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  });

  test("[TC-E-099] con un pedido que ya no está pendiente, Cobros pendientes lo avisa, no destaca nada y limpia la URL", async ({
    kdsPageMozo,
  }) => {
    // Un id con formato válido que no es de ningún pedido pendiente.
    await kdsPageMozo.goto(
      `${COBROS_PATH}?pedido=00000000-0000-4000-8000-000000000000`,
    );
    await expect(
      kdsPageMozo
        .getByRole("status")
        .filter({ hasText: "Ese pedido ya no está pendiente de cobro." }),
    ).toBeVisible({ timeout: 15000 });
    await expect(kdsPageMozo).toHaveURL(new RegExp(`${COBROS_PATH}$`));
    await expect(kdsPageMozo.getByText("Aviso de efectivo")).toHaveCount(0);
  });
});
