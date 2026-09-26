import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ITEM_DISPONIBLE, ITEM_NO_DISPONIBLE, MESA_PATH, TENANT_ID } from '../support/ids';

// E2E de HU-001. Los IDs vienen de e2e/support/ids.ts (BL-181) — mismo
// contrato que apps/backend/prisma/seed.ts. Si el seed cambia esos UUIDs,
// alcanza con actualizar ese único archivo.
const MENU_PATH = MESA_PATH;

test.describe('HU-001: Menú digital vía QR', () => {
  test('[TC-E-001] HU-001: carga el menú en menos de 3s y muestra los ítems del seed', async ({ page }) => {
    // Warm-up: la primera visita en `next dev` compila la ruta on-demand,
    // lo cual no es representativo de producción ni de lo que mide el
    // criterio de aceptación. Cargamos una vez sin medir, así el timing real
    // de abajo refleja la app ya compilada, no el costo de compilación.
    await page.goto(MENU_PATH);
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();

    const inicio = Date.now();
    await page.goto(MENU_PATH);
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
    const duracionMs = Date.now() - inicio;

    // Criterio de aceptación de HU-001: "El menú carga en menos de 3 segundos
    // en red 4G". Esto mide contra localhost, que es más rápido que 4G real —
    // sirve como piso de rendimiento, no reemplaza una medición con
    // throttling real de red (pendiente: agregar vía CDP session si hace
    // falta más precisión antes de cerrar el DoD completo).
    expect(duracionMs).toBeLessThan(3000);
  });

  test('[TC-E-002] HU-001: muestra nombre, descripción y precio de cada ítem', async ({ page }) => {
    await page.goto(MENU_PATH);

    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
    await expect(page.getByText('Con papas fritas y ensalada mixta')).toBeVisible();
    await expect(page.getByText('$ 590')).toBeVisible();
  });

  test('[TC-E-003] HU-001: bloquea visualmente un ítem no disponible sin ocultarlo', async ({ page }) => {
    await page.goto(MENU_PATH);

    const itemNoDisponible = page.locator('article', { hasText: ITEM_NO_DISPONIBLE });

    // Sigue visible (no se filtra/oculta) — criterio de aceptación explícito.
    await expect(itemNoDisponible).toBeVisible();
    await expect(itemNoDisponible.getByText('No disponible')).toBeVisible();
    await expect(itemNoDisponible).toHaveAttribute('aria-disabled', 'true');
  });

  test('[TC-E-004] HU-001: devuelve una página de error controlada para una mesa inexistente', async ({ page }) => {
    const mesaInexistente = '00000000-0000-0000-0000-000000000000';
    await page.goto(`/m/${TENANT_ID}/${mesaInexistente}`);

    await expect(
      page.getByText('No encontramos el menú para esta mesa'),
    ).toBeVisible();
  });

  test('[TC-E-005] HU-001: no tiene errores críticos de accesibilidad (axe-core)', async ({ page }) => {
    await page.goto(MENU_PATH);

    const resultados = await new AxeBuilder({ page })
      .include('main')
      .analyze();

    const violacionesCriticas = resultados.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(violacionesCriticas).toEqual([]);
  });
});