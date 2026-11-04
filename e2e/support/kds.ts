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

/**
 * BL-441: las alertas del mozo se guardan en el servidor hasta que alguien las
 * atiende, así que un test que presiona «Llamar al mozo» las deja pendientes
 * en el panel de cualquier mozo (y en staging, entre las alertas reales).
 * Esto las desestima desde el tablero del KDS al terminar el test.
 *
 * Es "best effort", como `intentarEntregarPedido`: si la alerta no está (el
 * test falló antes de llamar) no tapa el error original del test.
 */
export async function intentarDesestimarLlamado(
  kdsPage: Page,
  mesaNumero: number,
): Promise<void> {
  try {
    const alerta = kdsPage
      .getByRole("alert")
      .filter({ hasText: new RegExp(`Mesa ${mesaNumero} solicita atención`, "i") });
    await alerta.getByRole("button", { name: "Desestimar" }).click({
      timeout: 5000,
    });
    await expect(alerta).toBeHidden({ timeout: 5000 });
  } catch {
    // Lo que quede pendiente lo limpia el cierre de la mesa o su aceptación.
  }
}
