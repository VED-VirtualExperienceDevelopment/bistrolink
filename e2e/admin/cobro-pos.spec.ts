import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, KDS_PATH, MENU_URL_PATH } from "../support/ids";
import { continuarAlPago } from "../support/pago";

// HU-007b (BL-80): el mozo registra un cobro hecho con el POS del local.
//
// Igual que TC-E-046 (efectivo): el comensal arma un pedido para retirar y
// se queda en «Pagá tu pedido» (PENDIENTE_PAGO). El mozo lo cobra con el POS
// (simulado: solo se registra el número de autorización) desde /admin/cobros
// y el pedido aparece en el KDS. Usa la pestaña ya logueada del fixture
// kdsPageMozo.
//
// BL-477: al terminar, el pedido lo cierra el fixture pedidosDeTest.

const COBROS_PATH = "/admin/cobros";

/** Mismo código que muestran la pantalla del comensal y la del mozo. */
const codigoDelPedido = (pedidoId: string) =>
  `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

test.describe("BL-80: Cobro con el POS del local", () => {
  test("[TC-E-080] HU-007b: el mozo registra el cobro con el POS de un pedido para retirar (débito y n.° de autorización), sin errores graves de accesibilidad, y el pedido llega al KDS", async ({
    page,
    kdsPageMozo,
  }) => {
    test.slow();
    // 1. El comensal confirma el carrito y no paga con tarjeta.
    await page.goto(MENU_URL_PATH);
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
    await page
      .getByRole("button", {
        name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
      })
      .click();
    const pedidoId = await continuarAlPago(page);
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
    await fila.getByRole("button", { name: "Cobrar con el POS" }).click();

    // 3. Elige débito y carga la autorización del voucher.
    const dialogo = kdsPageMozo.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole("radio", { name: "Débito" }).check();
    const confirmar = dialogo.getByRole("button", { name: "Registrar cobro" });
    await expect(confirmar).toBeDisabled();
    await dialogo.getByLabel("Número de autorización").fill("e2e123");

    const resultados = await new AxeBuilder({ page: kdsPageMozo })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
    ).toEqual([]);

    const [cobroRes] = await Promise.all([
      kdsPageMozo.waitForResponse(
        (res) =>
          res.url().endsWith("/cobros/pos") &&
          res.request().method() === "POST",
      ),
      confirmar.click(),
    ]);
    expect(cobroRes.status()).toBe(201);
    expect(await cobroRes.json()).toMatchObject({
      tarjeta: "DEBITO",
      autorizacion: "E2E123",
    });
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
  });
});
