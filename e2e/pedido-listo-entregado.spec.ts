import { test, expect } from '@playwright/test';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const KDS_PATH = '/kds';

const KDS_USER = process.env.TEST_MOZO_USERNAME ?? 'mozo-test';
const KDS_PASS = process.env.TEST_MOZO_PASSWORD ?? 'Test1234!';

test('BL-65 E2E: cocina->mozo->comensal, pedido llega a Entregado', async ({ context }) => {
  const kdsPage = await context.newPage();
  await kdsPage.goto(KDS_PATH);
  await kdsPage.waitForURL(/\/login|\/realms\//);
  await kdsPage.locator('input[name="username"]').fill(KDS_USER);
  await kdsPage.locator('input[type="password"]').fill(KDS_PASS);
  await kdsPage.getByRole('button', { name: /sign in|iniciar sesión/i }).click();
  await kdsPage.waitForURL(KDS_PATH);

  const comensalPage = await context.newPage();
  await comensalPage.goto(`/m/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`);

  await comensalPage.getByRole('button', { name: /^Agregar/ }).first().click();

  const [pedidoRes] = await Promise.all([
    comensalPage.waitForResponse(
      (res) => res.url().endsWith('/pedidos') && res.request().method() === 'POST',
    ),
    comensalPage.getByRole('button', { name: 'Realizar pedido' }).click(),
  ]);
  const { id: pedidoId } = await pedidoRes.json();

  // Identificamos el ticket por el id real del pedido que acabamos de
  // crear, no por texto/orden — el tablero puede tener basura de
  // corridas anteriores que no llegaron a completarse.
  const ticket = kdsPage.locator(`article[data-pedido-id="${pedidoId}"]`);
  await expect(ticket).toBeVisible({ timeout: 5000 });

  const estadoActual = (texto: string) =>
    comensalPage.getByRole('paragraph').filter({ hasText: texto });

  // Esperar a que el socket de SeguimientoPedido termine de unirse a la
  // sala del pedido antes de disparar transiciones - si no, la primera
  // transicion puede quedar fuera de la carrera (ver nota en la respuesta).
  await expect(comensalPage.getByText('🟢 En vivo')).toBeVisible({ timeout: 5000 });

  await ticket.getByRole('button', { name: 'Marcar en preparación' }).click();
  await expect(estadoActual('En preparación')).toBeVisible({ timeout: 5000 });

  await ticket.getByRole('button', { name: 'Listo para entregar' }).click();

  await expect(kdsPage.getByText(/pedido listo para entregar/i)).toBeVisible({ timeout: 5000 });
  await expect(estadoActual('Listo para entregar')).toBeVisible({ timeout: 5000 });

  await kdsPage
    .locator(`[data-pedido-id="${pedidoId}"]`)
    .getByRole('button', { name: 'Confirmar entrega' })
    .click();
    
  await expect(kdsPage.getByText(/pedido listo para entregar/i)).not.toBeVisible();
  await expect(ticket).not.toBeVisible();
  await expect(estadoActual('Entregado')).toBeVisible({ timeout: 5000 });
});
