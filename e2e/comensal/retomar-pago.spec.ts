import { test, expect } from "../support/auth";
import type { Page } from "@playwright/test";
import {
  ITEM_DISPONIBLE,
  KDS_PATH,
  MENU_URL_PATH,
  MESA_ID,
} from "../support/ids";
import { ALERTAS_PATH, intentarEntregarPedido } from "../support/kds";
import { continuarAlPago } from "../support/pago";

// BL-448: al recargar la página, el comensal vuelve a donde estaba (pantalla
// de pago o «Esperando al mozo») con el mismo pedido, sin crear otro. Y el
// aviso de efectivo aparece en un KDS abierto después de la solicitud.
//
// Necesita el efectivo habilitado en el establecimiento del seed (valor por
// defecto). Los pedidos de mesa se cobran y se entregan desde el KDS al
// terminar, para no dejar avisos ni tickets abiertos.

const COBROS_PATH = "/admin/cobros";

const codigoDelPedido = (pedidoId: string) =>
  `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

/** Agrega el ítem de prueba al carrito. */
async function agregarItem(page: Page): Promise<void> {
  await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
  await page
    .getByRole("button", {
      name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
    })
    .click();
}

/** Elige efectivo, dice con cuánto paga y avisa al mozo. */
async function avisarQuePagaEnEfectivo(
  page: Page,
  pedidoId: string,
  pagaCon: string,
): Promise<void> {
  const efectivo = page.getByRole("radio", { name: /Efectivo/ });
  await expect(efectivo).toBeVisible({ timeout: 10000 });
  await efectivo.check();
  await page.getByLabel("¿Con cuánto vas a pagar?").fill(pagaCon);
  const [solicitud] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().endsWith(`/pedidos/${pedidoId}/pagos/solicitud-efectivo`) &&
        res.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Avisar al mozo" }).click(),
  ]);
  expect(solicitud.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Esperando al mozo" }),
  ).toBeVisible();
}

/** El mozo cobra el pedido desde «Cobros pendientes» (best effort en el cierre). */
async function cobrarEnEfectivo(
  kdsPage: Page,
  pedidoId: string,
): Promise<void> {
  await kdsPage.goto(COBROS_PATH);
  const fila = kdsPage
    .getByRole("listitem")
    .filter({ hasText: `Pedido ${codigoDelPedido(pedidoId)}` });
  await expect(fila).toBeVisible({ timeout: 15000 });
  await fila.getByRole("button", { name: "Cobrar en efectivo" }).click();
  const dialogo = kdsPage.getByRole("dialog");
  const [cobro] = await Promise.all([
    kdsPage.waitForResponse(
      (res) =>
        res.url().endsWith("/cobros/efectivo") &&
        res.request().method() === "POST",
    ),
    dialogo.getByRole("button", { name: "Confirmar cobro" }).click(),
  ]);
  expect(cobro.status()).toBe(201);
}

/** Cuenta los POST /pedidos que hace la página (no tiene que crear otro). */
function contarPedidosCreados(page: Page): () => number {
  let creados = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/pedidos")) creados += 1;
  });
  return () => creados;
}

test.describe("BL-448: Retomar el pago al recargar", () => {
  test("[TC-E-059] BL-448: el comensal pide efectivo, recarga y sigue esperando al mozo; al cobrar pasa a cocina", async ({
    page,
    kdsPageMozo,
    qrMesas,
  }) => {
    test.slow();
    let pedidoId: string | undefined;
    let cobrado = false;
    try {
      await page.goto(qrMesas.ruta(MESA_ID));
      await agregarItem(page);
      pedidoId = await continuarAlPago(page);
      await avisarQuePagaEnEfectivo(page, pedidoId, "10000");

      // Recarga: vuelve a «Esperando al mozo», con el mismo pedido.
      const creados = contarPedidosCreados(page);
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Esperando al mozo" }),
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page.getByText(`Pedido ${codigoDelPedido(pedidoId)}`),
      ).toBeVisible();
      expect(creados()).toBe(0);

      // El mozo cobra y la pantalla pasa sola a cocina.
      await cobrarEnEfectivo(kdsPageMozo, pedidoId);
      cobrado = true;
      await expect(
        page.getByRole("heading", { name: "¡Tu pedido ya está en cocina!" }),
      ).toBeVisible({ timeout: 20000 });
    } finally {
      if (pedidoId && !cobrado) {
        await cobrarEnEfectivo(kdsPageMozo, pedidoId).catch(() => undefined);
      }
      await kdsPageMozo.goto(KDS_PATH).catch(() => undefined);
      await intentarEntregarPedido(kdsPageMozo, pedidoId);
    }
  });

  test("[TC-E-060] BL-448: el comensal recarga en la pantalla de pago con tarjeta y vuelve a esa pantalla con el mismo pedido", async ({
    page,
  }) => {
    // Pedido para retirar (carta web): se retoma con su token de acceso.
    await page.goto(MENU_URL_PATH);
    await agregarItem(page);
    const pedidoId = await continuarAlPago(page);

    const creados = contarPedidosCreados(page);
    await page.reload();

    await expect(
      page.getByRole("heading", { name: "Pagá tu pedido" }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText(`Pedido ${codigoDelPedido(pedidoId)}`),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Tarjeta de débito o crédito" }),
    ).toBeVisible();
    expect(creados()).toBe(0);

    // [S] En sessionStorage no hay JWT ni datos de tarjeta.
    const guardado = await page.evaluate(() =>
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith("bistrolink:pedido-en-curso"))
        .map((k) => sessionStorage.getItem(k) ?? "")
        .join(""),
    );
    expect(guardado).toContain(pedidoId);
    expect(guardado).not.toMatch(/eyJ[\w-]+\./);
    expect(guardado).not.toContain("5031");
  });

  test("[TC-E-061] BL-448: con la pantalla Alertas abierta después de la solicitud de efectivo, el aviso aparece", async ({
    page,
    kdsPageMozo,
    qrMesas,
  }) => {
    test.slow();
    let pedidoId: string | undefined;
    try {
      await page.goto(qrMesas.ruta(MESA_ID));
      await agregarItem(page);
      pedidoId = await continuarAlPago(page);
      // Un monto que no use otro test, para encontrar este aviso.
      await avisarQuePagaEnEfectivo(page, pedidoId, "7777");

      // BL-460: el aviso de efectivo ya no está en el tablero del KDS, se
      // atiende desde la pantalla Alertas. Se abre después: el evento en vivo
      // ya pasó y el aviso tiene que llegar en el snapshot de la conexión nueva.
      await kdsPageMozo.goto(ALERTAS_PATH);
      await expect(
        kdsPageMozo
          .getByRole("main")
          .getByRole("listitem")
          .filter({ hasText: "quiere pagar en efectivo" })
          .filter({ hasText: /7\.777/ }),
      ).toBeVisible({ timeout: 15000 });
    } finally {
      if (pedidoId) {
        await cobrarEnEfectivo(kdsPageMozo, pedidoId).catch(() => undefined);
        await kdsPageMozo.goto(KDS_PATH).catch(() => undefined);
        await intentarEntregarPedido(kdsPageMozo, pedidoId);
      }
    }
  });
});
