import { test as base, type BrowserContext, type Page } from "@playwright/test";
import { KDS_PATH } from "./ids";
import { obtenerQrMesas, tokenAdminDesdePanel, type QrMesas } from "./qr-mesas";

// BL-181: antes cada spec que necesitaba una sesión de staff en /kds
// declaraba su propia función `prepararKds(context: any)` casi idéntica
// (llamado-mozo.spec.ts y observaciones-kds.spec.ts) — acá queda una sola
// vez, tipada de verdad, como fixtures de Playwright en vez de un helper
// suelto que cada archivo tenía que acordarse de copiar bien.

interface Credenciales {
  username: string;
  password: string;
}

// Las credenciales salen solo de variables de entorno: sin valores por
// defecto. Un fallback con usuario y contraseña en el código queda público
// (el repositorio es público) y termina siendo la contraseña real del entorno.
// En CI las pasa el job de Playwright desde los secrets; en local se cargan en
// la sesión con los valores del Keycloak local (ver e2e/README.md).
function credenciales(prefijo: "TEST_MOZO" | "TEST_ADMIN"): Credenciales {
  const username = process.env[`${prefijo}_USERNAME`];
  const password = process.env[`${prefijo}_PASSWORD`];
  if (!username || !password) {
    throw new Error(
      `Faltan ${prefijo}_USERNAME o ${prefijo}_PASSWORD en el entorno (ver e2e/README.md).`,
    );
  }
  return { username, password };
}

/**
 * Loguea contra Keycloak en una pestaña nueva del contexto dado y la deja
 * posicionada en /kds ya autenticada y renderizada.
 */
async function loginKds(
  context: BrowserContext,
  credenciales: Credenciales,
): Promise<Page> {
  const kdsPage = await context.newPage();
  await kdsPage.goto(KDS_PATH);
  await kdsPage.waitForURL(/\/login|\/realms\//);

  // El frontend interpone su propia pantalla de confirmación en /login
  // ("Ingresar" / "Cancelar") antes de redirigir al login hosteado por
  // Keycloak — el formulario de usuario/contraseña recién existe después de
  // ese click. Si ya caímos directo en /realms/ (Keycloak), no hay nada que
  // clickear acá.
  if (/\/login(?:\?|$)/.test(kdsPage.url())) {
    await kdsPage.getByRole("button", { name: /ingresar/i }).click();
    await kdsPage.waitForURL(/\/realms\//);
  }

  await kdsPage.locator('input[name="username"]').fill(credenciales.username);
  await kdsPage.locator('input[type="password"]').fill(credenciales.password);
  await kdsPage
    .getByRole("button", { name: /sign in|iniciar sesión/i })
    .click();

  await kdsPage.waitForURL(KDS_PATH);
  await kdsPage
    .getByRole("heading", { name: "Pedidos activos" })
    .waitFor({ timeout: 15000 });

  return kdsPage;
}

type Fixtures = {
  /** Pestaña de /kds ya logueada como MOZO — no reemplaza `page`, así el
   *  spec puede seguir usando `page` en paralelo para simular al comensal. */
  kdsPageMozo: Page;
  /** Idem, pero logueada como ADMIN. */
  kdsPageAdmin: Page;
};

type WorkerFixtures = {
  /**
   * HU-034 (BL-204): URLs de los QR de las mesas del seed (/q/<token>).
   * Una vez por worker: loguea un ADMIN en un contexto aparte, pide
   * GET /mesas/qr y cierra ese contexto. Solo lee los QR, nunca los regenera.
   */
  qrMesas: QrMesas;
};

export const test = base.extend<Fixtures, WorkerFixtures>({
  qrMesas: [
    async ({ playwright }, use) => {
      // El login del ADMIN corre SIEMPRE en Chromium, no en el navegador del
      // proyecto: es solo un paso de preparación para obtener las URLs de
      // los QR. En WebKit (mobile-safari) el login de Keycloak vuelve a
      // /login después del callback, y el fixture se colgaba hasta el
      // timeout aunque el test (TC-E-007) no tuviera nada que ver con eso.
      const browser = await playwright.chromium.launch();
      let qrMesas: QrMesas;
      try {
        // newContext() no hereda el `use` de playwright.config.ts: el baseURL
        // se pasa a mano, con el mismo valor por defecto.
        const context = await browser.newContext({
          baseURL: process.env.BASE_URL ?? "http://localhost:3000",
        });
        const adminPage = await loginKds(context, credenciales("TEST_ADMIN"));
        const authorization = await tokenAdminDesdePanel(adminPage);
        qrMesas = await obtenerQrMesas(context.request, authorization);
      } finally {
        await browser.close();
      }
      await use(qrMesas);
    },
    { scope: "worker" },
  ],
  kdsPageMozo: async ({ context }, use) => {
    const kdsPage = await loginKds(context, credenciales("TEST_MOZO"));
    await use(kdsPage);
  },
  kdsPageAdmin: async ({ context }, use) => {
    const kdsPage = await loginKds(context, credenciales("TEST_ADMIN"));
    await use(kdsPage);
  },
});

export { expect } from "@playwright/test";
