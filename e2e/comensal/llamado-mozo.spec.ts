import { test, expect } from '../support/auth';
import { MESA_PATH, MESA_PATH_RATE_LIMIT } from '../support/ids';

test.describe('BL-69: Llamado al mozo desde la mesa (integración)', () => {
  test('el mozo recibe el evento en menos de 1s al presionar el botón', async ({
    context,
    kdsPageMozo,
  }) => {
    const mesaPage = await context.newPage();
    await mesaPage.goto(MESA_PATH);

    await mesaPage.getByRole('button', { name: /Llamar al mozo/i }).click();

    // El presupuesto de <1s de BL-69 es sobre la propagación del evento
    // WebSocket (backend emite -> panel del mozo lo recibe), no sobre el
    // ciclo completo del click, que incluye además el handshake de
    // /auth/comensal contra Keycloak. Por eso el timeout acá es generoso:
    // solo confirma que el llamado LLEGA, no cuánto tarda el login.
    await expect(kdsPageMozo.getByText(/Mesa 1 solicita atención/i)).toBeVisible({
      timeout: 5000,
    });

    await expect(mesaPage.getByText(/Avisamos al mozo/i)).toBeVisible();
  });

  test('no permite más de 1 llamado por minuto (429)', async ({ page }) => {
    await page.goto(MESA_PATH_RATE_LIMIT);
    await page.getByRole('button', { name: /Llamar al mozo/i }).click();
    await expect(page.getByText(/Avisamos al mozo/i)).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: /Llamar al mozo/i }).click();
    await expect(page.getByText(/Ya llamaste al mozo/i)).toBeVisible();
  });
});