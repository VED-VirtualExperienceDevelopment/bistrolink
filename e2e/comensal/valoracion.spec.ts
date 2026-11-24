import { test, expect } from "../support/auth";
import { MENU_URL_PATH } from "../support/ids";
import { confirmarYPagar } from "../support/pago";
import { entregarRetiroConCodigo } from "../support/kds";

/**
 * HU-050 (BL-558): el comensal valora su pedido después de la entrega y el
 * Administrador lo ve en «Valoraciones», sin el pedido ni la mesa.
 */
test("[TC-E-127] HU-050: valoración privada después de la entrega, y el administrador la ve", async ({
  kdsPageAdmin,
  page,
}) => {
  test.setTimeout(120_000);
  const comentario = `Prueba E2E ${Date.now()}: rico y a tiempo`;

  await page.goto(MENU_URL_PATH);
  await page
    .getByRole("button", { name: /^Agregar/ })
    .first()
    .click();
  const pedidoId = await confirmarYPagar(page);

  // Cocina y entrega (el pedido del enlace web se entrega con su código).
  const ticket = kdsPageAdmin.locator(`article[data-pedido-id="${pedidoId}"]`);
  await expect(ticket).toBeVisible({ timeout: 10000 });
  await ticket.getByRole("button", { name: "Marcar en preparación" }).click();
  await ticket.getByRole("button", { name: "Listo para entregar" }).click();
  await expect(
    ticket.getByRole("button", { name: "Entregar con código" }),
  ).toBeVisible({ timeout: 5000 });
  await entregarRetiroConCodigo(kdsPageAdmin, ticket);

  // El comensal: la valoración aparece en «Gracias por tu compra».
  const valoracion = page.getByTestId("valoracion-pedido");
  await expect(
    valoracion.getByRole("heading", { name: "¿Cómo estuvo tu pedido?" }),
  ).toBeVisible({ timeout: 15000 });

  // Sin elegir estrellas no se envía.
  await valoracion.getByRole("button", { name: "Enviar valoración" }).click();
  await expect(valoracion.getByRole("alert")).toHaveText(
    "Elegí de 1 a 5 estrellas.",
  );

  // Con el teclado: de la primera estrella a la cuarta.
  await valoracion.getByRole("radio", { name: "1 de 5: Malo" }).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect(
    valoracion.getByRole("radio", { name: "4 de 5: Muy bueno" }),
  ).toBeChecked();

  await valoracion.getByLabel(/Contanos más/).fill(comentario);
  await valoracion.getByRole("button", { name: "Enviar valoración" }).click();
  await expect(valoracion.getByRole("status")).toHaveText(
    "¡Gracias! Le llegó al local. No se publica.",
  );

  // El administrador la ve, con las estrellas y el día, sin la mesa.
  await kdsPageAdmin.goto("/admin/valoraciones");
  await kdsPageAdmin
    .getByRole("search", { name: "Filtrar las valoraciones" })
    .getByText("Hoy", { exact: true })
    .click();
  const fila = kdsPageAdmin
    .getByRole("listitem")
    .filter({ hasText: comentario });
  await expect(fila).toBeVisible({ timeout: 10000 });
  await expect(fila).toContainText("4 de 5");
  await expect(fila).not.toContainText(/mesa|pedido/i);
  await expect(
    kdsPageAdmin.getByRole("heading", { name: "Promedio" }),
  ).toBeVisible();
});
