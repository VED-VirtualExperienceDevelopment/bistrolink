import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MESA_PATH } from "../support/ids";
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
// BL-204: cuando la URL de la mesa pase a ser /q/<token>, MESA_PATH tiene que
// reemplazarse por la URL del QR de la mesa.

test.describe("BL-309: Pedido desde la mesa", () => {
  test("[TC-E-017] HU-003: pedido desde la mesa, se confirma y queda en Recibido", async ({
    page,
    kdsPageMozo,
  }) => {
    let pedidoId: string | undefined;
    try {
      await page.goto(MESA_PATH);
      await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();

      await page
        .getByRole("button", {
          name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
        })
        .click();
      await expect(page.getByText(/Tu pedido \(1 item\)/i)).toBeVisible();

      // Se verifican las dos llamadas que fallaban: el token del comensal
      // (antes 404 en /auth/comensal/mesa) y la creación del pedido (antes
      // 400 por restauranteId).
      const [authRes, pedidoRes] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes("/auth/comensal") &&
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
  }) => {
    let pedidoId: string | undefined;
    try {
      await page.goto(MESA_PATH);
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

      // MESA_PATH es la mesa 1 del seed (MESA_A1_ID). El número sale de la
      // base, no del cliente (BL-244).
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
