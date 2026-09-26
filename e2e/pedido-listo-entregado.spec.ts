import { test, expect } from './support/auth';
import { MENU_URL_PATH } from './support/ids';

test('[TC-E-016] HU-018: cocina mozo comensal, pedido llega a Entregado', async ({ kdsPageMozo, page }) => {
  const kdsPage = kdsPageMozo;
  const comensalPage = page;

  await comensalPage.goto(MENU_URL_PATH);

  await comensalPage.getByRole('button', { name: /^Agregar/ }).first().click();

  const [pedidoRes] = await Promise.all([
    comensalPage.waitForResponse(
      (res) => res.url().endsWith('/pedidos') && res.request().method() === 'POST',
    ),
    comensalPage.getByRole('button', { name: 'Realizar pedido' }).click(),
  ]);
  const { id: pedidoId } = await pedidoRes.json();

  const ticket = kdsPage.locator(`article[data-pedido-id="${pedidoId}"]`);
  await expect(ticket).toBeVisible({ timeout: 5000 });

  const estadoActual = (texto: string) =>
    comensalPage.getByRole('paragraph').filter({ hasText: texto });

  await expect(comensalPage.getByText('🟢 En vivo')).toBeVisible({ timeout: 5000 });

  await ticket.getByRole('button', { name: 'Marcar en preparación' }).click();
  await expect(estadoActual('En preparación')).toBeVisible({ timeout: 5000 });

  await ticket.getByRole('button', { name: 'Listo para entregar' }).click();

  const banner = kdsPage.locator(`[data-pedido-id="${pedidoId}"]`, {
    hasText: 'pedido listo para entregar',
  });
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(estadoActual('Listo para entregar')).toBeVisible({ timeout: 5000 });

  await banner.getByRole('button', { name: 'Confirmar entrega' }).click();

  await expect(banner).not.toBeVisible();
  await expect(ticket).not.toBeVisible();
  await expect(estadoActual('Entregado')).toBeVisible({ timeout: 5000 });
});
