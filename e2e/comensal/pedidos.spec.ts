import { test, expect } from '@playwright/test';
import { ITEM_DISPONIBLE, MENU_URL_PATH } from '../support/ids';

test.describe('HU-003: Carrito y confirmación de pedido', () => {
  test('[TC-E-010] HU-003: agregar un ítem, confirmar, y ver la confirmación visual', async ({ page }) => {
    await page.goto(MENU_URL_PATH);
    await page.goto(MENU_URL_PATH);
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();

    await page
      .getByRole('button', { name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, 'i') })
      .click();

    await expect(page.getByText(/Tu pedido \(1 item\)/i)).toBeVisible();

    await page.getByRole('button', { name: 'Realizar pedido' }).click();

    await expect(
      page.getByText('¡Pedido enviado! Cocina ya lo recibió.'),
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText(/Tu pedido \(/i)).not.toBeVisible();

    await expect(
      page.getByText('¡Pedido enviado! Cocina ya lo recibió.'),
    ).toBeVisible({ timeout: 10000 });

    // Verificación explícita del criterio de aceptación: estado 'Recibido'.
    await expect(page.getByText('Estado: RECIBIDO')).toBeVisible();
  });

  test('[TC-E-011] HU-003: agregar dos unidades del mismo ítem suma la cantidad, no duplica la fila', async ({
    page,
  }) => {
    await page.goto(MENU_URL_PATH);
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();

    const botonAgregar = page.getByRole('button', {
      name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, 'i'),
    });
    await botonAgregar.click();
    await botonAgregar.click();

    await expect(page.getByText(/Tu pedido \(2 items\)/i)).toBeVisible();
    await expect(page.getByText(`2x ${ITEM_DISPONIBLE}`)).toBeVisible();
  });
});