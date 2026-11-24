import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
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
//
// BL-501: si el comensal se arrepiente, el mozo lo cancela antes de cobrarlo,
// en la misma pantalla (TC-E-085) o desde «Cobros pendientes» (TC-E-086).

const codigoDelPedido = (pedidoId: string) =>
  `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

/** Carga un pedido de un ítem en la mesa del seed y devuelve su id. */
async function cargarPedido(pagina: Page): Promise<string> {
  await pagina.goto(`/admin/mesas/pedido?mesa=${MESA_ID}`);
  await pagina
    .getByRole("button", { name: `Agregar una unidad de ${ITEM_DISPONIBLE}` })
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
  return ((await pedidoRes.json()) as { id: string }).id;
}

/** Confirma el diálogo de cancelación y espera la respuesta. */
async function confirmarCancelacion(pagina: Page, pedidoId: string) {
  const dialogo = pagina.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  const [res] = await Promise.all([
    pagina.waitForResponse(
      (r) =>
        r.url().endsWith(`/cobros/pendientes/${pedidoId}/cancelar`) &&
        r.request().method() === "POST",
    ),
    dialogo.getByRole("button", { name: "Cancelar pedido" }).click(),
  ]);
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ pedidoId, estado: "CANCELADO" });
}

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

  test("[TC-E-085] BL-501: el mozo carga el pedido de una mesa y lo cancela ahí mismo antes de cobrarlo; no queda entre los cobros pendientes y el diálogo no tiene errores graves de accesibilidad", async ({
    kdsPageMozo,
    qrMesas,
  }) => {
    test.slow();
    expect(qrMesas.ruta(MESA_ID)).toBeTruthy();
    const pagina = kdsPageMozo;
    const pedidoId = await cargarPedido(pagina);
    const codigo = codigoDelPedido(pedidoId);

    await pagina.getByRole("button", { name: "Cancelar pedido" }).click();
    const dialogo = pagina.getByRole("dialog");
    await expect(dialogo).toContainText("todavía no se cobró");
    const resultados = await new AxeBuilder({ page: pagina })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
    ).toEqual([]);

    await confirmarCancelacion(pagina, pedidoId);
    await expect(
      pagina.getByText(
        `Pedido ${codigo} cancelado. No se cobró y no pasa a cocina.`,
      ),
    ).toBeVisible();
    await expect(
      pagina.getByRole("button", { name: "Cobrar en efectivo" }),
    ).toHaveCount(0);

    await pagina.goto("/admin/cobros");
    await expect(
      pagina.getByRole("heading", { level: 1 }).first(),
    ).toBeVisible();
    await expect(
      pagina.getByRole("listitem").filter({ hasText: `Pedido ${codigo}` }),
    ).toHaveCount(0);
  });

  test("[TC-E-086] BL-501: el mozo cancela desde «Cobros pendientes» un pedido que todavía no se cobró y deja de aparecer", async ({
    kdsPageMozo,
    qrMesas,
  }) => {
    test.slow();
    expect(qrMesas.ruta(MESA_ID)).toBeTruthy();
    const pagina = kdsPageMozo;
    const pedidoId = await cargarPedido(pagina);
    const codigo = codigoDelPedido(pedidoId);

    await pagina.goto("/admin/cobros");
    const fila = pagina
      .getByRole("listitem")
      .filter({ hasText: `Pedido ${codigo}` });
    await expect(fila).toBeVisible({ timeout: 15000 });
    await fila.getByRole("button", { name: "Cancelar pedido" }).click();
    await confirmarCancelacion(pagina, pedidoId);

    await expect(
      pagina.getByText(
        `Pedido ${codigo} cancelado. No se cobró y no pasa a cocina.`,
      ),
    ).toBeVisible();
    await expect(fila).toHaveCount(0);
  });
});
