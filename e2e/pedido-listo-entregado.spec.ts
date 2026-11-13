import { test, expect } from "./support/auth";
import { MENU_URL_PATH } from "./support/ids";
import { confirmarYPagar } from "./support/pago";

test("[TC-E-016] HU-018: cocina mozo comensal, pedido llega a Entregado", async ({
  kdsPageMozo,
  page,
}) => {
  const kdsPage = kdsPageMozo;
  const comensalPage = page;

  await comensalPage.goto(MENU_URL_PATH);

  await comensalPage
    .getByRole("button", { name: /^Agregar/ })
    .first()
    .click();

  // BL-311 (prepago, RD.03): el pedido llega a cocina con el pago aprobado.
  const pedidoId = await confirmarYPagar(comensalPage);

  const ticket = kdsPage.locator(`article[data-pedido-id="${pedidoId}"]`);
  await expect(ticket).toBeVisible({ timeout: 5000 });

  const estadoActual = (texto: string) =>
    comensalPage.getByRole("status").filter({ hasText: texto });

  // HU-038 (BL-504): indicador de conexión de tres estados.
  await expect(
    comensalPage
      .getByTestId("indicador-conexion")
      .filter({ hasText: "En vivo" }),
  ).toBeVisible({ timeout: 5000 });

  await ticket.getByRole("button", { name: "Marcar en preparación" }).click();
  await expect(estadoActual("En preparación")).toBeVisible({ timeout: 5000 });

  await ticket.getByRole("button", { name: "Listo para entregar" }).click();

  // BL-460: el tablero ya no muestra el aviso de pedido listo; la entrega se
  // confirma con el botón de la propia comanda.
  const entregar = ticket.getByRole("button", {
    name: "Marcar como entregado",
  });
  await expect(entregar).toBeVisible({ timeout: 5000 });
  await expect(estadoActual("Listo para entregar")).toBeVisible({
    timeout: 5000,
  });

  await entregar.click();

  await expect(ticket).not.toBeVisible();
  // BL-502: con el pedido entregado, el seguimiento se reemplaza por la
  // pantalla «Gracias por tu compra» (ya no queda un estado «Entregado»).
  await expect(
    comensalPage
      .getByTestId("gracias-por-tu-compra")
      .getByRole("heading", { name: "Gracias por tu compra" }),
  ).toBeVisible({ timeout: 10000 });
});
