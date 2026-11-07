import { expect, type Page } from "@playwright/test";

/** Pantalla Alertas del panel (BL-441). */
export const ALERTAS_PATH = "/admin/alertas";

/**
 * Lleva un pedido hasta ENTREGADO desde el tablero del KDS, con los mismos
 * botones que usa el mozo (el mismo recorrido que TC-E-016). BL-460: el
 * tablero ya no tiene avisos; la entrega se confirma con el botón «Marcar como
 * entregado» de la propia comanda.
 *
 * Es un paso de prueba (falla si no anda). Para no dejar pedidos abiertos no
 * hace falta: los cierra el fixture `pedidosDeTest` (BL-477, support/auth.ts).
 */
export async function entregarPedidoDesdeKds(
  kdsPage: Page,
  pedidoId: string,
): Promise<void> {
  const ticket = kdsPage.locator(`article[data-pedido-id="${pedidoId}"]`);
  await expect(ticket).toBeVisible({ timeout: 5000 });

  await ticket.getByRole("button", { name: "Marcar en preparación" }).click();
  await ticket.getByRole("button", { name: "Listo para entregar" }).click();

  await ticket.getByRole("button", { name: "Marcar como entregado" }).click();

  await expect(ticket).not.toBeVisible({ timeout: 5000 });
}

/**
 * BL-441: el llamado de una mesa queda pendiente en el servidor hasta que el
 * mozo lo atiende, y se atiende desde la pantalla Alertas (el tablero del KDS
 * ya no muestra los llamados normales). Este paso lo desestima al terminar el
 * test, para no dejar alertas pendientes que contaminen a los demás.
 *
 * "Best effort": si no hay alerta de esa mesa (por ejemplo, porque el test
 * falló antes de llamar), no tapa el error original con uno nuevo. Los
 * llamados viven en memoria del backend, no en un pedido: la limpieza de
 * BL-477 no los cierra.
 */
export async function intentarDesestimarLlamado(
  kdsPage: Page,
  mesaNumero: number,
): Promise<void> {
  try {
    await kdsPage.goto(ALERTAS_PATH);
    const alerta = kdsPage
      .getByRole("main")
      .getByRole("listitem")
      .filter({
        hasText: new RegExp(`Mesa ${mesaNumero} solicita atención`, "i"),
      });
    await alerta
      .getByRole("button", {
        name: `Desestimar la alerta de la mesa ${mesaNumero}`,
      })
      .click({ timeout: 5000 });
    await expect(alerta).toBeHidden({ timeout: 5000 });
  } catch {
    // Si quedó pendiente, vence sola a las 12 h o al cerrar la mesa.
  }
}
