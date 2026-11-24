import {
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { KDS_PATH, MESA_ID, MESA_ID_RATE_LIMIT } from "./ids";
import {
  cerrarPedidosDeTest,
  registrarPedidosDelContexto,
  tokenVigente,
  type PedidosDeTest,
  type SesionLimpieza,
} from "./limpieza";
import {
  asegurarMesasAbiertas,
  obtenerQrMesas,
  tokenAdminDesdePanel,
  type QrMesas,
} from "./qr-mesas";

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
function credenciales(
  prefijo: "TEST_MOZO" | "TEST_ADMIN" | "TEST_COCINA",
): Credenciales {
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
  // «Ingresar» es el texto del tema de BistroLink (BL-346). «Iniciar sesión»
  // y «Sign in» quedan para un Keycloak que todavía no tenga el tema nuevo.
  await kdsPage
    .getByRole("button", { name: /ingresar|iniciar sesión|sign in/i })
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
  /**
   * HU-038 (BL-510): /kds logueado como COCINA (monitor de solo lectura), en
   * su PROPIO contexto del navegador: si compartiera el de kdsPageMozo,
   * Keycloak reusaría la sesión del mozo. Sin TEST_COCINA_USERNAME y
   * TEST_COCINA_PASSWORD en el entorno, el test se saltea.
   */
  kdsPageCocina: Page;
  /**
   * BL-477 (BL-285): automático en todos los tests. Junta los pedidos que
   * crean las páginas del test y al terminar, pase o falle, los cierra con
   * POST /testing/limpieza. Ver support/limpieza.ts.
   */
  pedidosDeTest: PedidosDeTest;
};

type WorkerFixtures = {
  /**
   * HU-034 (BL-204): URLs de los QR de las mesas del seed (/q/<token>).
   * Una vez por worker: loguea un ADMIN en un contexto aparte, pide
   * GET /mesas/qr y cierra ese contexto. Solo lee los QR, nunca los regenera.
   * BL-432: además deja abiertas MESA_ID y MESA_ID_RATE_LIMIT (sin cambiar la
   * sesión de una mesa que ya estaba abierta).
   */
  qrMesas: QrMesas;
  /**
   * BL-477: sesión de ADMIN para la limpieza, una por worker. Recién loguea
   * cuando un test tiene pedidos para cerrar, y pide un token nuevo cuando
   * el anterior está por vencer.
   */
  sesionLimpieza: SesionLimpieza;
};

/** baseURL para los contextos que se crean a mano (no heredan el `use`). */
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

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
        const context = await browser.newContext({ baseURL: BASE_URL });
        const adminPage = await loginKds(context, credenciales("TEST_ADMIN"));
        const authorization = await tokenAdminDesdePanel(adminPage);
        qrMesas = await obtenerQrMesas(context.request, authorization);
        // BL-432: el QR de una mesa cerrada no abre la carta (HU-017).
        await asegurarMesasAbiertas(context.request, authorization, [
          MESA_ID,
          MESA_ID_RATE_LIMIT,
        ]);
      } finally {
        await browser.close();
      }
      await use(qrMesas);
    },
    { scope: "worker" },
  ],
  sesionLimpieza: [
    async ({ playwright }, use) => {
      // En Chromium, como qrMesas (ver el comentario de arriba).
      let browser: Browser | undefined;
      let adminPage: Page | undefined;
      let authorization: string | undefined;
      const sesion: SesionLimpieza = {
        async authorization() {
          if (tokenVigente(authorization)) return authorization;
          if (!adminPage) {
            // Si un login anterior falló, reusa el navegador ya abierto.
            browser ??= await playwright.chromium.launch();
            const context = await browser.newContext({ baseURL: BASE_URL });
            adminPage = await loginKds(context, credenciales("TEST_ADMIN"));
          }
          // El panel renueva el token con la sesión de Keycloak.
          authorization = await tokenAdminDesdePanel(adminPage);
          return authorization;
        },
      };
      try {
        await use(sesion);
      } finally {
        await browser?.close();
      }
    },
    { scope: "worker" },
  ],
  pedidosDeTest: [
    async ({ context, request, sesionLimpieza }, use, testInfo) => {
      const { pedidos, terminar } = registrarPedidosDelContexto(context);
      await use(pedidos);
      await terminar();
      await cerrarPedidosDeTest(request, sesionLimpieza, pedidos.ids, testInfo);
    },
    // Tiempo propio: la limpieza corre aunque el test se haya pasado del
    // suyo, y el primer cierre del worker incluye el login del ADMIN.
    { auto: true, timeout: 60_000 },
  ],
  kdsPageMozo: async ({ context }, use) => {
    const kdsPage = await loginKds(context, credenciales("TEST_MOZO"));
    await use(kdsPage);
  },
  kdsPageAdmin: async ({ context }, use) => {
    const kdsPage = await loginKds(context, credenciales("TEST_ADMIN"));
    await use(kdsPage);
  },
  kdsPageCocina: async ({ browser }, use, testInfo) => {
    testInfo.skip(
      !process.env.TEST_COCINA_USERNAME || !process.env.TEST_COCINA_PASSWORD,
      "Faltan TEST_COCINA_USERNAME o TEST_COCINA_PASSWORD (ver e2e/README.md).",
    );
    const contextoCocina = await browser.newContext({ baseURL: BASE_URL });
    try {
      const kdsPage = await loginKds(
        contextoCocina,
        credenciales("TEST_COCINA"),
      );
      await use(kdsPage);
    } finally {
      await contextoCocina.close();
    }
  },
});

export { expect } from "@playwright/test";
