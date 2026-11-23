import { test, expect } from "../support/auth";
import AxeBuilder from "@axe-core/playwright";
import {
  ENLACE_VIEJO_MESA_PATH,
  ITEM_DISPONIBLE,
  ITEM_NO_DISPONIBLE,
  MESA_ID,
} from "../support/ids";

// E2E de HU-001. Los IDs vienen de e2e/support/ids.ts (BL-181) — mismo
// contrato que apps/backend/prisma/seed.ts. Si el seed cambia esos UUIDs,
// alcanza con actualizar ese único archivo.
//
// HU-034 (BL-204): el menú de la mesa se abre desde la URL del QR
// (/q/<token>), que da el fixture `qrMesas` (support/auth.ts).

// BL-607: perfil «Fast 4G» de Chrome DevTools (9 Mbps de bajada, 1,5 Mbps
// de subida y 60 ms de latencia, con los mismos ajustes que aplica
// DevTools: 90 % del ancho de banda y latencia x 2,75). El throughput va en
// bytes por segundo.
const RED_4G = {
  offline: false,
  latency: 60 * 2.75,
  downloadThroughput: ((9 * 1000 * 1000) / 8) * 0.9,
  uploadThroughput: ((1.5 * 1000 * 1000) / 8) * 0.9,
};
const SIN_LIMITE_DE_RED = {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
};

test.describe("HU-001: Menú digital vía QR", () => {
  test("[TC-E-001] HU-001: carga el menú en menos de 3s y muestra los ítems del seed", async ({
    page,
    qrMesas,
  }) => {
    const menuPath = qrMesas.ruta(MESA_ID);

    // Primera visita sin medir: despierta los servicios de staging (o
    // compila la ruta en `next dev`). Así lo que se mide es la carga del
    // menú y no el arranque.
    await page.goto(menuPath);
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();

    // BL-607: el criterio de HU-001 y de la Línea de Base es «el menú carga
    // en menos de 3 segundos en red 4G». La medición se hace con la red
    // limitada al perfil «Fast 4G» de Chrome DevTools y sin caché, como un
    // comensal que abre la carta por primera vez desde el celular. Se usa
    // una sesión CDP: este spec corre solo en el proyecto chromium.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", RED_4G);

    try {
      const inicio = Date.now();
      await page.goto(menuPath);
      await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
      const duracionMs = Date.now() - inicio;
      console.log(`TC-E-001: menú cargado en ${duracionMs} ms con red 4G`);

      expect(
        duracionMs,
        `El menú tardó ${duracionMs} ms con red 4G; el máximo es 3000 ms.`,
      ).toBeLessThan(3000);
    } finally {
      // La pestaña es solo de este test, pero se deja la red como estaba
      // por si algo la reutiliza.
      await cdp.send("Network.emulateNetworkConditions", SIN_LIMITE_DE_RED);
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
      await cdp.detach();
    }
  });

  test("[TC-E-002] HU-001: muestra nombre, descripción y precio de cada ítem", async ({
    page,
    qrMesas,
  }) => {
    await page.goto(qrMesas.ruta(MESA_ID));

    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
    await expect(
      page.getByText("Con papas fritas y ensalada mixta"),
    ).toBeVisible();
    // exact: sin él, «$ 590» también matchea «$ 590,50» del ítem que crea
    // TC-E-050 (gestion-carta.spec.ts) en paralelo, o que dejó una corrida
    // anterior, y el locator falla por strict mode.
    await expect(page.getByText("$ 590", { exact: true })).toBeVisible();
    // BL-204: la portada muestra el número de la mesa del QR. BL-592: junto
    // a «En el local», que salió de la barra superior.
    await expect(
      page.getByText("En el local · Mesa 1", { exact: true }),
    ).toBeVisible();
  });

  test("[TC-E-003] HU-001: bloquea visualmente un ítem no disponible sin ocultarlo", async ({
    page,
    qrMesas,
  }) => {
    await page.goto(qrMesas.ruta(MESA_ID));

    // Por el título exacto, no por texto: así no la confunde con otra
    // tarjeta que mencione el mismo nombre en su descripción (ver TC-E-007).
    const itemNoDisponible = page.locator("article").filter({
      has: page.getByRole("heading", { name: ITEM_NO_DISPONIBLE, exact: true }),
    });

    // Sigue visible (no se filtra/oculta) — criterio de aceptación explícito.
    await expect(itemNoDisponible).toBeVisible();
    await expect(itemNoDisponible.getByText("No disponible")).toBeVisible();
    await expect(itemNoDisponible).toHaveAttribute("aria-disabled", "true");
  });

  test("[TC-E-004] HU-001: devuelve una página de error controlada para un QR inválido", async ({
    page,
  }) => {
    // Formato válido (base64url) pero no es un QR emitido por el backend:
    // el descifrado falla y la API responde 404.
    await page.goto("/q/EsteQrNoExisteEnNingunaMesa");

    await expect(
      page.getByText("No encontramos el menú para esta mesa"),
    ).toBeVisible();
  });

  test("[TC-E-005] HU-001: no tiene errores críticos de accesibilidad (axe-core)", async ({
    page,
    qrMesas,
  }) => {
    await page.goto(qrMesas.ruta(MESA_ID));
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();

    const resultados = await new AxeBuilder({ page }).include("main").analyze();

    const violacionesCriticas = resultados.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );

    expect(violacionesCriticas).toEqual([]);
  });

  test("[TC-E-019] HU-034: el enlace viejo de mesa por ids muestra un aviso y no abre el menú", async ({
    page,
  }) => {
    await page.goto(ENLACE_VIEJO_MESA_PATH);

    await expect(page.getByText("Este enlace ya no se usa.")).toBeVisible();
    await expect(page.getByText(ITEM_DISPONIBLE)).toHaveCount(0);
  });
});
