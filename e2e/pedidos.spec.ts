import { test, expect } from '@playwright/test';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MENU_PATH = `/m/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`;

test.describe('HU-003: Carrito y confirmación de pedido', () => {
  test('agregar un ítem, confirmar, y ver la confirmación visual', async ({ page }) => {
    await page.goto(MENU_PATH);
    await page.goto(MENU_PATH);
    await expect(page.getByText('Milanesa a la napolitana')).toBeVisible();

    await page
      .getByRole('button', { name: /Agregar Milanesa a la napolitana/i })
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

  test('agregar dos unidades del mismo ítem suma la cantidad, no duplica la fila', async ({
    page,
  }) => {
    await page.goto(MENU_PATH);
    await expect(page.getByText('Milanesa a la napolitana')).toBeVisible();

    const botonAgregar = page.getByRole('button', {
      name: /Agregar Milanesa a la napolitana/i,
    });
    await botonAgregar.click();
    await botonAgregar.click();

    await expect(page.getByText(/Tu pedido \(2 items\)/i)).toBeVisible();
    await expect(page.getByText('2x Milanesa a la napolitana')).toBeVisible();
  });
});
