import { expect, type Page } from "@playwright/test";

/**
 * Lleva un pedido hasta ENTREGADO desde el tablero del KDS, con los mismos
 * botones que usa el mozo (el mismo recorrido que TC-E-016).
 *
 * Sirve para que los E2E no dejen tickets abiertos en la cocina. No borra el
 * pedido: queda en la base como ENTREGADO. El borrado (y que los datos de
 * prueba no cuenten como ventas en la analítica) es BL-285.
 */
export async function entregarPedidoDesdeKds(
  kdsPage: Page,
  pedidoId: string,
): Promise<void> {
  const ticket = kdsPage.locator(`article[data-pedido-id="${pedidoId}"]`);
  await expect(ticket).toBeVisible({ timeout: 5000 });

  await ticket.getByRole("button", { name: "Marcar en preparación" }).click();
  await ticket.getByRole("button", { name: "Listo para entregar" }).click();

  const banner = kdsPage.locator(`[data-pedido-id="${pedidoId}"]`, {
    hasText: "pedido listo para entregar",
  });
  await expect(banner).toBeVisible({ timeout: 5000 });
  await banner.getByRole("button", { name: "Confirmar entrega" }).click();

  await expect(ticket).not.toBeVisible({ timeout: 5000 });
}

/**
 * Versión "best effort" para el cierre de un test: si el pedido no se puede
 * entregar (por ejemplo, porque el test falló antes de que llegara al KDS),
 * no tapa el error original del test con uno nuevo.
 */
export async function intentarEntregarPedido(
  kdsPage: Page,
  pedidoId: string | undefined,
): Promise<void> {
  if (!pedidoId) return;
  try {
    await entregarPedidoDesdeKds(kdsPage, pedidoId);
  } catch {
    // Lo que quede abierto lo levanta la limpieza de BL-285.
  }
}
