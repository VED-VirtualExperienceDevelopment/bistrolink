import { test, expect } from '../support/auth';
import { ITEM_DISPONIBLE, MENU_URL_PATH } from '../support/ids';

test.describe('BL-154/BL-155: Observaciones visibles en KDS (E2E)', () => {
  test('observación general de alergia a nivel de pedido es visible en el KDS', async ({
    context,
    kdsPageAdmin,
  }) => {
    // 1. Simular al comensal
    const menuPage = await context.newPage();
    await menuPage.goto(MENU_URL_PATH);
    await expect(menuPage.getByText(ITEM_DISPONIBLE)).toBeVisible();

    await menuPage.getByRole('button', { name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, 'i') }).click();
    await expect(menuPage.getByText(/Tu pedido \(1 item\)/i)).toBeVisible();

    const observacionGeneral = 'Alergia severa al maní. No usar aceite de maní.';
    await menuPage.getByLabel(/instrucciones generales|alergias/i).fill(observacionGeneral);

    // 2. Comensal confirma el pedido
    await menuPage.getByRole('button', { name: 'Realizar pedido' }).click();
    await expect(menuPage.getByText('¡Pedido enviado! Cocina ya lo recibió.')).toBeVisible({
      timeout: 10000,
    });

    // 3. Forzar recarga en el KDS para obtener el estado más reciente
    await kdsPageAdmin.reload();
    await expect(kdsPageAdmin.getByRole('heading', { name: 'Pedidos activos' })).toBeVisible({
      timeout: 10000,
    });

    // 4. VALIDACIÓN CONDICIONAL: Verificamos si el pedido realmente apareció en el KDS.
    // isVisible() devuelve true/false sin lanzar errores, perfecto para esta lógica.
    //
    // NOTA (BL-181, hallazgo, no resuelto acá): este skip condicional se
    // salta el test sobre el propio resultado que se está probando — si la
    // integración en tiempo real está rota, el test queda verde en vez de
    // fallar. Se deja documentado como candidato a historia aparte; no se
    // toca en esta reorganización para no mezclar cambios de comportamiento
    // de test con la limpieza de estructura.
    const pedidoVisible = await kdsPageAdmin.getByText(ITEM_DISPONIBLE).isVisible({ timeout: 8000 });

    if (!pedidoVisible) {
      test.skip(true, 'El pedido no se renderizó en el KDS tras la creación (integración en tiempo real pendiente). Test omitido condicionalmente.');
    }

    // 5. Si llegamos acá, el KDS sí mostró el pedido, así que validamos las observaciones
    await expect(kdsPageAdmin.getByText(ITEM_DISPONIBLE)).toBeVisible();
    await expect(kdsPageAdmin.locator('.bg-error-container', { hasText: observacionGeneral })).toBeVisible();
  });

  test('observación de ítem específico ("sin sal") es visible junto al ítem correcto en el KDS', async ({
    context,
    kdsPageAdmin,
  }) => {
    // 1. Simular al comensal
    const menuPage = await context.newPage();
    await menuPage.goto(MENU_URL_PATH);
    await expect(menuPage.getByText(ITEM_DISPONIBLE)).toBeVisible();

    await menuPage.getByRole('button', { name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, 'i') }).click();
    await expect(menuPage.getByText(/Tu pedido \(1 item\)/i)).toBeVisible();

    const observacionItem = 'sin sal';

    // 2. Comensal agrega nota al ítem específico
    await menuPage.getByRole('button', { name: /editar nota/i }).click();
    await expect(menuPage.getByRole('dialog')).toBeVisible();

    await menuPage.getByRole('dialog').locator('textarea').fill(observacionItem);
    await menuPage.getByRole('dialog').getByRole('button', { name: /guardar nota/i }).click();

    await expect(menuPage.getByText(observacionItem)).toBeVisible();

    // 3. Comensal confirma el pedido
    await menuPage.getByRole('button', { name: 'Realizar pedido' }).click();
    await expect(menuPage.getByText('¡Pedido enviado! Cocina ya lo recibió.')).toBeVisible({
      timeout: 10000,
    });

    // 4. Forzar recarga en el KDS
    await kdsPageAdmin.reload();
    await expect(kdsPageAdmin.getByRole('heading', { name: 'Pedidos activos' })).toBeVisible({
      timeout: 10000,
    });

    // 5. VALIDACIÓN CONDICIONAL (ver nota arriba)
    const pedidoVisible = await kdsPageAdmin.getByText(ITEM_DISPONIBLE).isVisible({ timeout: 8000 });

    if (!pedidoVisible) {
      test.skip(true, 'El pedido no se renderizó en el KDS tras la creación (integración en tiempo real pendiente). Test omitido condicionalmente.');
    }

    // 6. Validar que la observación está junto al ítem correcto
    await expect(kdsPageAdmin.getByText(ITEM_DISPONIBLE)).toBeVisible();

    const ticketItem = kdsPageAdmin.locator('div').filter({
      has: kdsPageAdmin.getByText(ITEM_DISPONIBLE),
    }).filter({
      has: kdsPageAdmin.locator('.text-error', { hasText: observacionItem }),
    });

    await expect(ticketItem).toBeVisible();
  });
});