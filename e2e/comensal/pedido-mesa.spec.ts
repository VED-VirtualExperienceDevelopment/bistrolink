import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MESA_ID } from "../support/ids";
import { entregarPedidoDesdeKds, intentarEntregarPedido } from "../support/kds";

// BL-309: el pedido desde el menú de una mesa nunca llegaba a crearse (auth
// a una ruta inexistente y restauranteId obligatorio en el DTO), y ningún
// E2E lo cubría: pedidos.spec.ts y pedido-listo-entregado.spec.ts usan el
// link web del local (MENU_URL_PATH), no la mesa.
//
// Los dos tests cierran su pedido (ENTREGADO) desde el KDS, para no dejar
// tickets abiertos en la cocina. El cierre corre en `finally`: también si el
// test falla a mitad de camino.
//
// HU-034 (BL-204): la mesa se abre desde la URL de su QR (fixture qrMesas).
// El pedido lleva el token en X-Mesa-Token y el body no lleva ningún id: la
// mesa (y su restaurante) los resuelve el backend a partir del QR.

test.describe("BL-309: Pedido desde la mesa", () => {
  test("[TC-E-017] HU-003: pedido desde la mesa, se confirma y queda en Recibido", async ({
    page,
    kdsPageMozo,
    qrMesas,
  }) => {
    let pedidoId: string | undefined;
    try {
      await page.goto(qrMesas.ruta(MESA_ID));
      await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();

      await page
        .getByRole("button", {
          name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
        })
        .click();
      await expect(page.getByText(/Tu pedido \(1 item\)/i)).toBeVisible();

      // Se verifican las dos llamadas: el token del comensal (BL-309: antes
      // 404) y la creación del pedido (BL-309: antes 400 por restauranteId).
      const [authRes, pedidoRes] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().endsWith("/auth/comensal/mesa") &&
            res.request().method() === "POST",
        ),
        page.waitForResponse(
          (res) =>
            res.url().endsWith("/pedidos") && res.request().method() === "POST",
        ),
        page.getByRole("button", { name: "Realizar pedido" }).click(),
      ]);
      expect(authRes.status()).toBe(200);
      expect(pedidoRes.status()).toBe(201);
      pedidoId = (await pedidoRes.json()).id;

      // BL-204: el QR viaja en el header y el body no trae ids.
      const pedidoReq = pedidoRes.request();
      expect(pedidoReq.headers()["x-mesa-token"]).toBe(qrMesas.token(MESA_ID));
      const body = pedidoReq.postDataJSON();
      expect(body).not.toHaveProperty("mesaId");
      expect(body).not.toHaveProperty("restauranteId");

      await expect(page.getByText("¡Pedido enviado a cocina!")).toBeVisible({
        timeout: 10000,
      });

      // El carrito se vacía al confirmar.
      await expect(page.getByText(/Tu pedido \(/i)).not.toBeVisible();

      // Mismo criterio que TC-E-010 (BL-253): el paso actual del seguimiento.
      const pasoActual = page.locator('li[aria-current="step"]');
      await expect(pasoActual).toHaveCount(1);
      await expect(pasoActual).toContainText("Recibido");
    } finally {
      await intentarEntregarPedido(kdsPageMozo, pedidoId);
    }
  });

  test("[TC-E-018] HU-003: el pedido desde la mesa llega al KDS con su número de mesa", async ({
    page,
    kdsPageMozo,
    qrMesas,
  }) => {
    let pedidoId: string | undefined;
    try {
      await page.goto(qrMesas.ruta(MESA_ID));
      await page
        .getByRole("button", {
          name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
        })
        .click();

      const [pedidoRes] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().endsWith("/pedidos") && res.request().method() === "POST",
        ),
        page.getByRole("button", { name: "Realizar pedido" }).click(),
      ]);
      expect(pedidoRes.status()).toBe(201);
      pedidoId = (await pedidoRes.json()).id;

      // MESA_ID es la mesa 1 del seed (MESA_A1_ID). El número sale de la
      // base, a partir del QR, no del cliente (BL-244 / BL-204).
      const ticket = kdsPageMozo.locator(
        `article[data-pedido-id="${pedidoId}"]`,
      );
      await expect(ticket).toBeVisible({ timeout: 5000 });
      await expect(ticket.getByText("Mesa 1", { exact: true })).toBeVisible();

      // Cierre como parte del test: acá sí tiene que funcionar (el ticket ya
      // está en el tablero), así que se usa la versión que falla si no anda.
      await entregarPedidoDesdeKds(kdsPageMozo, pedidoId!);
      pedidoId = undefined;
    } finally {
      await intentarEntregarPedido(kdsPageMozo, pedidoId);
    }
  });
});
