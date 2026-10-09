import { test, expect } from '../support/auth';
import { ITEM_DISPONIBLE, MENU_URL_PATH } from '../support/ids';

// BL-253: cada test identifica SU pedido en el KDS con una marca única en
// la observación, en lugar de buscar por el nombre del ítem (staging acumula
// pedidos de corridas anteriores con el mismo ítem).
//
// El KDS se abre como MOZO porque mozo-test pertenece al tenant de testing
// (1111…), el mismo donde se crea el pedido. Con el RLS activo (BL-275), un
// usuario de otro tenant no ve estos pedidos.
//
// La tarjeta de cada pedido es el <article data-testid="pedido-kds"> de
// OrderTicket.tsx.

test.describe('BL-154/BL-155: Observaciones visibles en KDS (E2E)', () => {
  test('[TC-E-014] HU-021: observación general de alergia a nivel de pedido es visible en el KDS', async ({
    context,
    kdsPageMozo,
  }, testInfo) => {
    const marca = `e2e-${testInfo.project.name}-${Date.now()}`;
    const observacionGeneral = `Alergia severa al maní. No usar aceite de maní. [${marca}]`;

    // 1. Comensal arma el pedido con la observación general
    const menuPage = await context.newPage();
    await menuPage.goto(MENU_URL_PATH);
    await expect(menuPage.getByText(ITEM_DISPONIBLE)).toBeVisible();

    await menuPage.getByRole('button', { name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, 'i') }).click();
    await expect(menuPage.getByText(/Tu pedido \(1 item\)/i)).toBeVisible();

    await menuPage.getByLabel(/instrucciones generales|alergias/i).fill(observacionGeneral);

    // 2. Comensal confirma
    await menuPage.getByRole('button', { name: 'Realizar pedido' }).click();
    await expect(menuPage.getByText('¡Pedido enviado! Cocina ya lo recibió.')).toBeVisible({
      timeout: 10000,
    });

    // 3. Recargar el KDS (BL-244: todavía no se actualiza solo)
    await kdsPageMozo.reload();
    await expect(kdsPageMozo.getByRole('heading', { name: 'Pedidos activos' })).toBeVisible({
      timeout: 10000,
    });

    // 4. La tarjeta de ESTE pedido: la única que contiene la marca
    const tarjeta = kdsPageMozo.getByTestId('pedido-kds').filter({ hasText: marca });
    await expect(tarjeta).toBeVisible({ timeout: 10000 });

    // 5. Ítem y observación, buscados solo dentro de esa tarjeta
    await expect(tarjeta.getByText(ITEM_DISPONIBLE)).toBeVisible();
    await expect(tarjeta.getByText(observacionGeneral)).toBeVisible();
  });

  test('[TC-E-015] HU-021: observación de ítem específico (sin sal) es visible junto al ítem correcto en el KDS', async ({
    context,
    kdsPageMozo,
  }, testInfo) => {
    const marca = `e2e-${testInfo.project.name}-${Date.now()}`;
    const observacionItem = `sin sal [${marca}]`;

    // 1. Comensal agrega el ítem
    const menuPage = await context.newPage();
    await menuPage.goto(MENU_URL_PATH);
    await expect(menuPage.getByText(ITEM_DISPONIBLE)).toBeVisible();

    await menuPage.getByRole('button', { name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, 'i') }).click();
    await expect(menuPage.getByText(/Tu pedido \(1 item\)/i)).toBeVisible();

    // 2. Nota sobre ese ítem
    await menuPage.getByRole('button', { name: /editar nota/i }).click();
    await expect(menuPage.getByRole('dialog')).toBeVisible();
    await menuPage.getByRole('dialog').locator('textarea').fill(observacionItem);
    await menuPage.getByRole('dialog').getByRole('button', { name: /guardar nota/i }).click();
    await expect(menuPage.getByText(observacionItem)).toBeVisible();

    // 3. Comensal confirma
    await menuPage.getByRole('button', { name: 'Realizar pedido' }).click();
    await expect(menuPage.getByText('¡Pedido enviado! Cocina ya lo recibió.')).toBeVisible({
      timeout: 10000,
    });

    // 4. Recargar el KDS
    await kdsPageMozo.reload();
    await expect(kdsPageMozo.getByRole('heading', { name: 'Pedidos activos' })).toBeVisible({
      timeout: 10000,
    });

    // 5. La tarjeta de ESTE pedido
    const tarjeta = kdsPageMozo.getByTestId('pedido-kds').filter({ hasText: marca });
    await expect(tarjeta).toBeVisible({ timeout: 10000 });

    // 6. El pedido tiene un solo ítem, así que la nota dentro de la tarjeta
    //    es la de ese ítem
    await expect(tarjeta.getByText(ITEM_DISPONIBLE)).toBeVisible();
    await expect(tarjeta.getByText(observacionItem)).toBeVisible();
  });
});