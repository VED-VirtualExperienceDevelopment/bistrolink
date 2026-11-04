import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../support/auth";

// HU-009 (BL-455): el administrador ve los comprobantes fiscales del
// restaurante y su estado ante la DGI en /admin/comprobantes.
// HU-023 (BL-96): y los pagos cobrados sin comprobante (pendientes de
// emisión). No se toca «Reintentar ahora»: emitiría un CFE en staging.
//
// Solo lectura: no cambia datos en staging. Usa la pestaña ya logueada del
// fixture kdsPageAdmin (support/auth.ts). No depende de que haya
// comprobantes emitidos: revisa la pantalla, los filtros y el pedido a la
// API.

const COMPROBANTES_PATH = "/admin/comprobantes";

test.describe("BL-455: Comprobantes del administrador", () => {
  test("[TC-E-065] HU-009: el administrador abre Comprobantes desde el menú, filtra por estado ante la DGI y la pantalla no tiene errores graves de accesibilidad", async ({
    kdsPageAdmin: page,
  }) => {
    await page.goto("/admin/mesas");
    await page.getByRole("link", { name: "Comprobantes" }).first().click();
    await expect(page).toHaveURL(new RegExp(`${COMPROBANTES_PATH}$`));
    await expect(
      page.getByRole("heading", { name: "Comprobantes", level: 1 }),
    ).toBeVisible();

    // Filtrar por estado pide los rechazados a la API.
    const [respuesta] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/admin/comprobantes?") &&
          res.url().includes("estado=RECHAZADO"),
      ),
      page.getByLabel("Estado ante la DGI").selectOption("RECHAZADO"),
    ]);
    expect(respuesta.status()).toBe(200);
    const cuerpo = (await respuesta.json()) as {
      comprobantes: { estadoDgi: string }[];
    };
    for (const c of cuerpo.comprobantes) {
      expect(c.estadoDgi).toBe("RECHAZADO");
    }
    // O la tabla o el aviso de que no hay.
    await expect(
      page
        .getByRole("table")
        .or(page.getByText("No hay comprobantes con esos filtros")),
    ).toBeVisible();

    // Un rango al revés se avisa sin consultar.
    await page.getByLabel("Desde").fill("2026-12-31");
    await page.getByLabel("Hasta").fill("2026-01-01");
    await expect(
      page.getByRole("alert").filter({ hasText: /anterior o igual/ }),
    ).toBeVisible();

    const resultados = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  });

  test("[TC-E-072] HU-023: el administrador abre la pestaña Pendientes de emisión y ve los pagos sin comprobante o el aviso de que no hay, sin errores graves de accesibilidad", async ({
    kdsPageAdmin: page,
  }) => {
    await page.goto(COMPROBANTES_PATH);
    await expect(
      page.getByRole("tab", { name: "Emitidos", selected: true }),
    ).toBeVisible();

    const [respuesta] = await Promise.all([
      page.waitForResponse((res) =>
        res.url().includes("/admin/comprobantes/pendientes"),
      ),
      page.getByRole("tab", { name: /Pendientes de emisión/ }).click(),
    ]);
    expect(respuesta.status()).toBe(200);
    const cuerpo = (await respuesta.json()) as {
      total: number;
      pendientes: unknown[];
    };

    const panel = page.getByRole("tabpanel", {
      name: /Pendientes de emisión/,
    });
    await expect(panel).toBeVisible();
    if (cuerpo.pendientes.length > 0) {
      await expect(panel.getByRole("table")).toBeVisible();
      await expect(
        panel.getByRole("button", { name: /Reintentar ahora/ }).first(),
      ).toBeEnabled();
    } else {
      await expect(
        panel.getByText("No hay pagos sin comprobante"),
      ).toBeVisible();
    }

    const resultados = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  });
});
