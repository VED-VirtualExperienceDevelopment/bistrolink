import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { KDS_PATH } from './ids';

// BL-181: antes cada spec que necesitaba una sesión de staff en /kds
// declaraba su propia función `prepararKds(context: any)` casi idéntica
// (llamado-mozo.spec.ts y observaciones-kds.spec.ts) — acá queda una sola
// vez, tipada de verdad, como fixtures de Playwright en vez de un helper
// suelto que cada archivo tenía que acordarse de copiar bien.

interface Credenciales {
  username: string;
  password: string;
}

const MOZO: Credenciales = {
  username: process.env.TEST_MOZO_USERNAME ?? 'mozo-test',
  password: process.env.TEST_MOZO_PASSWORD ?? 'Test1234!',
};

const ADMIN: Credenciales = {
  username: process.env.TEST_ADMIN_USERNAME ?? 'admin-test',
  password: process.env.TEST_ADMIN_PASSWORD ?? 'Test1234!',
};

/**
 * Loguea contra Keycloak en una pestaña nueva del contexto dado y la deja
 * posicionada en /kds ya autenticada y renderizada.
 */
async function loginKds(context: BrowserContext, credenciales: Credenciales): Promise<Page> {
  const kdsPage = await context.newPage();
  await kdsPage.goto(KDS_PATH);
  await kdsPage.waitForURL(/\/login|\/realms\//);

  // El frontend interpone su propia pantalla de confirmación en /login
  // ("Ingresar" / "Cancelar") antes de redirigir al login hosteado por
  // Keycloak — el formulario de usuario/contraseña recién existe después de
  // ese click. Si ya caímos directo en /realms/ (Keycloak), no hay nada que
  // clickear acá.
  if (/\/login(?:\?|$)/.test(kdsPage.url())) {
    await kdsPage.getByRole('button', { name: /ingresar/i }).click();
    await kdsPage.waitForURL(/\/realms\//);
  }

  await kdsPage.locator('input[name="username"]').fill(credenciales.username);
  await kdsPage.locator('input[type="password"]').fill(credenciales.password);
  await kdsPage.getByRole('button', { name: /sign in|iniciar sesión/i }).click();

  await kdsPage.waitForURL(KDS_PATH);
  await kdsPage.getByRole('heading', { name: 'Pedidos activos' }).waitFor({ timeout: 15000 });

  return kdsPage;
}

type Fixtures = {
  /** Pestaña de /kds ya logueada como MOZO — no reemplaza `page`, así el
   *  spec puede seguir usando `page` en paralelo para simular al comensal. */
  kdsPageMozo: Page;
  /** Idem, pero logueada como ADMIN. */
  kdsPageAdmin: Page;
};

export const test = base.extend<Fixtures>({
  kdsPageMozo: async ({ context }, use) => {
    const kdsPage = await loginKds(context, MOZO);
    await use(kdsPage);
  },
  kdsPageAdmin: async ({ context }, use) => {
    const kdsPage = await loginKds(context, ADMIN);
    await use(kdsPage);
  },
});

export { expect } from '@playwright/test';