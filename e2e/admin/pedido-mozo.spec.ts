import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, KDS_PATH, MESA_ID } from "../support/ids";

// HU-039 (BL-209): el mozo carga el pedido de un comensal sin celular.
//
// El mozo abre la pantalla de carga de una mesa abierta, arma el pedido, lo
// cobra en efectivo (BL-201) y el pedido aparece en el KDS. La mesa del seed
// la deja abierta el fixture qrMesas (BL-432). BL-477: al terminar, el pedido
// lo cierra el fixture pedidosDeTest (se registra solo: POST /pedidos/mozo).
//
// HU-007b (BL-485): en la misma pantalla también lo puede cobrar con el POS
// del local (TC-E-082).

test.describe("BL-209: Pedido cargado por el mozo", () => {
  test("[TC-E-049] HU-039: el mozo carga el pedido de una mesa, lo cobra en efectivo y aparece en el KDS", async ({
    kdsPageMozo,
    qrMesas,
  }) => {
    test.slow();
    // El fixture deja la mesa del seed abierta (sesión, HU-017).
    expect(qrMesas.ruta(MESA_ID)).toBeTruthy();
    const pagina = kdsPageMozo;
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
    const pedidoId = pedido.id;
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
  });

  test("[TC-E-082] HU-007b: el mozo carga el pedido de una mesa y lo cobra ahí mismo con el POS del local (crédito y n.° de autorización), sin errores graves de accesibilidad, y aparece en el KDS", async ({
    kdsPageMozo,
    qrMesas,
  }) => {
    test.slow();
    expect(qrMesas.ruta(MESA_ID)).toBeTruthy();
    const pagina = kdsPageMozo;
    // 1. Arma el pedido con la carta y lo confirma.
    await pagina.goto(`/admin/mesas/pedido?mesa=${MESA_ID}`);
    await pagina
      .getByRole("button", {
        name: `Agregar una unidad de ${ITEM_DISPONIBLE}`,
      })
      .click();
    const [pedidoRes] = await Promise.all([
      pagina.waitForResponse(
        (res) =>
          res.url().endsWith("/pedidos/mozo") &&
          res.request().method() === "POST",
      ),
      pagina.getByRole("button", { name: "Confirmar pedido" }).click(),
    ]);
    expect(pedidoRes.status()).toBe(201);
    const pedidoId = ((await pedidoRes.json()) as { id: string }).id;

    // 2. Se ofrecen los dos medios del comensal (el seed tiene los dos
    // habilitados) y lo cobra con el POS.
    await expect(
      pagina.getByRole("button", { name: "Cobrar en efectivo" }),
    ).toBeVisible();
    await pagina.getByRole("button", { name: "Cobrar con el POS" }).click();
    const dialogo = pagina.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole("radio", { name: "Crédito" }).check();
    await dialogo.getByLabel("Número de autorización").fill("e2e082");

    const resultados = await new AxeBuilder({ page: pagina })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
    ).toEqual([]);

    const [cobroRes] = await Promise.all([
      pagina.waitForResponse(
        (res) =>
          res.url().endsWith("/cobros/pos") &&
          res.request().method() === "POST",
      ),
      dialogo.getByRole("button", { name: "Registrar cobro" }).click(),
    ]);
    expect(cobroRes.status()).toBe(201);
    expect(await cobroRes.json()).toMatchObject({
      pedidoId,
      tarjeta: "CREDITO",
      autorizacion: "E2E082",
    });
    await expect(pagina.getByText(/^Cobro registrado/)).toBeVisible();

    // 3. El pedido llegó a cocina.
    await pagina.goto(KDS_PATH);
    await expect(
      pagina.getByRole("heading", { name: "Pedidos activos" }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      pagina.locator(`article[data-pedido-id="${pedidoId}"]`),
    ).toBeVisible({ timeout: 10000 });
  });
});
