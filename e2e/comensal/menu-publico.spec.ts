import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { MENU_URL_PATH, MESA_ID, RESTAURANTE_ID, TENANT_ID } from '../support/ids';
// MESA_PATH: solo lo usaba MENU_QR_PATH, para la regresión visual comentada
// más abajo. Si se reactiva esa sección, volver a importarlo.

// E2E de HU-002.
//
// Diseño escalable: los tests NO dependen de nombres de items hardcodeados.
// El backend es la fuente de verdad (contract testing): primero se consulta
// el menú vía API y luego se afirma que la UI muestra exactamente lo que la
// API declara. Cuando la DB se poble con más restaurantes/items, estos tests
// siguen funcionando sin cambios.
//
// Los IDs de fixture (tenant/restaurante/mesa) vienen de e2e/support/ids.ts
// (BL-181) — mismo contrato que e2e/comensal/menu.spec.ts (HU-001). Por el
// aislamiento multi-tenant (RLS), datos reales de OTROS tenants no afectan
// estas corridas.

// Backend como fuente de verdad. En CI apunta a la API de staging.
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

type ItemMenu = { nombre: string; disponible: boolean };
type CategoriaMenu = { items: ItemMenu[] };
type MenuResponse = {
  restaurante: { nombre: string };
  categorias: CategoriaMenu[];
};

/** Consulta el menú al backend y aplana los items de todas las categorías. */
async function obtenerMenu(
  request: APIRequestContext,
  url: string,
): Promise<MenuResponse> {
  const res = await request.get(url);
  expect(res.ok()).toBe(true);
  return (await res.json()) as MenuResponse;
}

function itemsDe(menu: MenuResponse): ItemMenu[] {
  return menu.categorias.flatMap((c) => c.items);
}

test.describe('HU-002: menú vía URL directa (verificado en mobile)', () => {
  test(' [TC-E-006] HU-002: renderiza el restaurante que declara la API, sin login', async ({
    page,
    request,
  }) => {
    const menu = await obtenerMenu(
      request,
      `${API_URL}/menu/tenant/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`,
    );

    await page.goto(MENU_URL_PATH);

    // El nombre viene de la API, no hardcodeado: si cambia el seed, sigue pasando.
    await expect(
      page.getByRole('heading', { name: menu.restaurante.nombre }),
    ).toBeVisible();
    await expect(page.getByText('Pedido desde fuera del local')).toBeVisible();
  });

  test('[TC-E-007] HU-002: muestra exactamente los items disponibles y oculta los agotados', async ({
    page,
    request,
  }) => {
    // Fuente de verdad de agotados: el endpoint QR (HU-001) devuelve TODOS
    // los items con su flag disponible. La invariante de HU-002 es que la
    // URL directa muestra solo los disponibles.
    const menuQr = await obtenerMenu(
      request,
      `${API_URL}/menu/${TENANT_ID}/${MESA_ID}`,
    );
    const disponibles = itemsDe(menuQr).filter((i) => i.disponible);
    const agotados = itemsDe(menuQr).filter((i) => !i.disponible);

    test.skip(disponibles.length === 0, 'Fixture sin items disponibles');

    await page.goto(MENU_URL_PATH);

    // Todo item disponible aparece (escalable: no depende de nombres).
    for (const item of disponibles) {
      await expect(
        page.getByRole('heading', { name: item.nombre }),
      ).toBeVisible();
    }

    // Y todo item agotado queda oculto (invariante de HU-002).
    for (const item of agotados) {
      await expect(
        page.getByRole('heading', { name: item.nombre }),
      ).toHaveCount(0);
    }
  });

  test('[TC-E-008] HU-002: permite agregar al carrito el primer item disponible que exista', async ({
    page,
    request,
  }) => {
    const menu = await obtenerMenu(
      request,
      `${API_URL}/menu/tenant/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`,
    );
    const primerItem = itemsDe(menu)[0];
    test.skip(!primerItem, 'Fixture sin items disponibles');

    await page.goto(MENU_URL_PATH);

    await page
      .getByRole('button', { name: new RegExp(`agregar ${primerItem.nombre}`, 'i') })
      .click();

    await expect(page.getByText(`1x ${primerItem.nombre}`)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /realizar pedido/i }),
    ).toBeVisible();
  });

  test('[TC-E-009] HU-002: error controlado para un restaurante inexistente', async ({ page }) => {
    // UUID cero: mismo patrón determinista que e2e/comensal/menu.spec.ts.
    await page.goto(
      `/m/${TENANT_ID}/restaurante/00000000-0000-0000-0000-000000000000`,
    );

    await expect(page.getByText('This page could not be found')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESIÓN VISUAL (snapshot): QR vs URL
//
// COMENTADA A PROPÓSITO (2026-09-20): la regresión visual corresponde a los
// sprints 8 y 9. Hasta entonces el foco es funcional, y sin baselines
// generados en Docker este describe fallaría siempre en CI (o generaría
// snapshots nuevos en cada corrida). Ver e2e/README.md.
//
// Para reactivar en el sprint 8: descomentar el bloque, restaurar el import
// de MESA_PATH y la const MENU_QR_PATH de arriba, y regenerar los baselines
// con `npm run test:e2e:update-snapshots`.
//
// Nota de escalabilidad (se mantiene para cuando se reactive): los snapshots
// capturan el estado visual de los datos del fixture. Cuando la DB se poble y
// el menú del fixture cambie A PROPÓSITO, se regeneran los baselines con
// --update-snapshots y se commitea el nuevo estado. Lo que detectan es la
// regresión visual NO intencional.
//
// BL-181: los baselines SIEMPRE se regeneran vía el contenedor Docker oficial
// de Playwright (ver npm run test:e2e:update-snapshots) — nunca a mano en la
// laptop de cada dev, porque el nombre de archivo incluye la plataforma
// (chromium-darwin vs chromium-linux) y CI corre en Linux.
// ─────────────────────────────────────────────────────────────────────────────
// test.describe('Regresión visual (snapshot): QR vs URL', () => {
//   const opcionesScreenshot = {
//     animations: 'disabled' as const,
//     maxDiffPixelRatio: 0.02,
//   };
//
//   test('menú QR (HU-001) sin regresiones visuales', async ({ page, request }) => {
//     const menu = await obtenerMenu(
//       request,
//       `${API_URL}/menu/${TENANT_ID}/${MESA_ID}`,
//     );
//
//     await page.goto(MENU_QR_PATH);
//     await expect(
//       page.getByRole('heading', { name: menu.restaurante.nombre }),
//     ).toBeVisible({ timeout: 15000 });
//
//     await expect(page).toHaveScreenshot('menu-qr.png', opcionesScreenshot);
//   });
//
//   test('menú URL (HU-002) sin regresiones visuales', async ({ page, request }) => {
//     const menu = await obtenerMenu(
//       request,
//       `${API_URL}/menu/tenant/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`,
//     );
//
//     await page.goto(MENU_URL_PATH);
//     await expect(
//       page.getByRole('heading', { name: menu.restaurante.nombre }),
//     ).toBeVisible({ timeout: 15000 });
//
//     await expect(page).toHaveScreenshot('menu-url.png', opcionesScreenshot);
//   });
// });