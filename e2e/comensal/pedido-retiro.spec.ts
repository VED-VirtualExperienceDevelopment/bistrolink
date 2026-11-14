import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, KDS_PATH, MENU_URL_PATH } from "../support/ids";
import { confirmarYPagar, continuarAlPago } from "../support/pago";

// HU-040 (BL-210): pedido para retirar por el enlace web del local.
//
// Necesita el local del seed tomando pedidos para retirar (es el valor por
// defecto: habilitado, todo el día). TC-E-098 paga con el sandbox de Mercado
// Pago (como TC-E-010); TC-E-099 cobra en efectivo (como TC-E-046) para no
// depender del sandbox. BL-477: los pedidos los cierra el fixture
// pedidosDeTest.

const COBROS_PATH = "/admin/cobros";
const CODIGO_RETIRO = /^R-\d{3}$/;

const codigoDelPedido = (pedidoId: string) =>
  `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

/** Otro código válido, distinto del del pedido. */
const otroCodigo = (codigo: string) =>
  `R-${String((Number(codigo.slice(2)) % 999) + 1).padStart(3, "0")}`;

test.describe("BL-210: Pedidos para retirar", () => {
  test("[TC-E-098] HU-040: el comensal deja su nombre, paga, ve su código de retiro y, sin recargar, el aviso de que está listo; el KDS muestra la comanda para retirar con el código y el nombre", async ({
    page,
    kdsPageMozo,
  }) => {
    test.slow();
    // 1. Arma el pedido y deja sus datos, aceptando el aviso.
    await page.goto(MENU_URL_PATH);
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
    await page
      .getByRole("button", {
        name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
      })
      .click();
    await page.getByLabel("Nombre").fill("Comensal E2E");
    await page.getByLabel("Teléfono o correo").fill("099 000 000");
    await page
      .getByRole("checkbox", { name: /Acepto que el local guarde mi nombre/ })
      .check();

    // 2. Paga: ve el código de retiro.
    const pedidoId = await confirmarYPagar(page);
    await expect(page.getByText("Código de retiro")).toBeVisible();
    const codigoEnPantalla = page.getByText(CODIGO_RETIRO);
    await expect(codigoEnPantalla).toBeVisible({ timeout: 15000 });
    const codigo = (await codigoEnPantalla.textContent())?.trim() ?? "";

    // 3. El KDS lo muestra como pedido para retirar.
    await kdsPageMozo.goto(KDS_PATH);
    const comanda = kdsPageMozo.locator(
      `article[data-pedido-id="${pedidoId}"]`,
    );
    await expect(comanda).toBeVisible({ timeout: 15000 });
    await expect(comanda).toContainText(`Para retirar · ${codigo}`);
    await expect(comanda.getByTestId("retiro-nombre")).toHaveText(
      "Comensal E2E",
    );

    // 4. La cocina lo prepara y lo marca listo.
    await comanda
      .getByRole("button", { name: "Marcar en preparación" })
      .click();
    await comanda.getByRole("button", { name: "Listo para entregar" }).click();

    // 5. El comensal ve el aviso sin recargar la página.
    const aviso = page.getByTestId("aviso-listo-para-retirar");
    await expect(aviso).toBeVisible({ timeout: 10000 });
    await expect(aviso).toContainText("Tu pedido está listo para retirar");
    await expect(aviso).toContainText(codigo);
  });

  test("[TC-E-099] HU-040: el mozo entrega el pedido para retirar con el código: con un código equivocado no lo entrega, sin errores graves de accesibilidad, y con el correcto sale del tablero", async ({
    page,
    kdsPageMozo,
  }) => {
    test.slow();
    // 1. Pedido para retirar, cobrado en efectivo por el mozo.
    await page.goto(MENU_URL_PATH);
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
    await page
      .getByRole("button", {
        name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
      })
      .click();
    const pedidoId = await continuarAlPago(page);

    await kdsPageMozo.goto(COBROS_PATH);
    const fila = kdsPageMozo
      .getByRole("listitem")
      .filter({ hasText: `Pedido ${codigoDelPedido(pedidoId)}` });
    await expect(fila).toBeVisible({ timeout: 15000 });
    await fila.getByRole("button", { name: "Cobrar en efectivo" }).click();
    const cobro = kdsPageMozo.getByRole("dialog");
    await cobro.getByLabel("Monto recibido").fill("99999");
    await cobro.getByRole("button", { name: "Confirmar cobro" }).click();
    await expect(fila).toHaveCount(0, { timeout: 10000 });

    // 2. En el KDS, el pedido listo no se entrega con el botón común.
    await kdsPageMozo.goto(KDS_PATH);
    const comanda = kdsPageMozo.locator(
      `article[data-pedido-id="${pedidoId}"]`,
    );
    await expect(comanda).toBeVisible({ timeout: 15000 });
    const encabezado = await comanda.textContent();
    const codigo = /Para retirar · (R-\d{3})/.exec(encabezado ?? "")?.[1];
    expect(codigo).toMatch(CODIGO_RETIRO);
    await comanda
      .getByRole("button", { name: "Marcar en preparación" })
      .click();
    await comanda.getByRole("button", { name: "Listo para entregar" }).click();
    await expect(
      comanda.getByRole("button", { name: "Marcar como entregado" }),
    ).toHaveCount(0);

    // 3. Con un código equivocado, no lo entrega.
    await comanda.getByRole("button", { name: "Entregar con código" }).click();
    const dialogo = kdsPageMozo.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    await dialogo.getByLabel("Código de retiro").fill(otroCodigo(codigo!));
    await dialogo.getByRole("button", { name: "Entregar" }).click();
    await expect(dialogo.getByRole("alert")).toContainText(
      "El código no coincide",
    );

    const resultados = await new AxeBuilder({ page: kdsPageMozo })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
    ).toEqual([]);

    // 4. Con el correcto, lo entrega y sale del tablero.
    await dialogo.getByLabel("Código de retiro").fill(codigo!);
    const [respuesta] = await Promise.all([
      kdsPageMozo.waitForResponse(
        (res) =>
          res.url().endsWith(`/pedidos/${pedidoId}/entregar-retiro`) &&
          res.request().method() === "POST",
      ),
      dialogo.getByRole("button", { name: "Entregar" }).click(),
    ]);
    expect(respuesta.status()).toBe(200);
    await expect(comanda).toHaveCount(0, { timeout: 10000 });
  });
});
