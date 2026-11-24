import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MENU_URL_PATH } from "../support/ids";
import { confirmarYPagar } from "../support/pago";
import { entregarRetiroConCodigo } from "../support/kds";

// HU-038 (BL-510): monitor de Cocina. El /kds de COCINA es de solo lectura:
// una tarjeta por pedido en preparación o listo, en una grilla sin scroll, y
// un resumen grande arriba. Los pedidos recibidos solo se cuentan.
//
// El mozo (kdsPageMozo) mueve los pedidos; Cocina (kdsPageCocina, en su
// propio contexto) solo mira. En el seed de testing la cola está apagada:
// los pedidos quedan recibidos hasta que el mozo los pasa a preparación.
// Pantalla de cocina típica: 1920×1080.

/** El comensal arma y paga un pedido; devuelve su id. */
async function crearPedido(
  context: BrowserContext,
  marca: string,
): Promise<string> {
  const menuPage = await context.newPage();
  await menuPage.goto(MENU_URL_PATH);
  await expect(menuPage.getByText(ITEM_DISPONIBLE)).toBeVisible();
  await menuPage
    .getByRole("button", {
      name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
    })
    .click();
  await menuPage
    .getByLabel(/instrucciones generales|alergias/i)
    .fill(`[${marca}]`);
  const pedidoId = await confirmarYPagar(menuPage);
  await menuPage.close();
  return pedidoId;
}

const comanda = (page: Page, pedidoId: string) =>
  page.locator(`article[data-pedido-id="${pedidoId}"]`);

/** Ni la página ni la grilla del monitor tienen scroll. */
async function sinScroll(page: Page) {
  return page.evaluate(() => {
    const raiz = document.scrollingElement ?? document.documentElement;
    const grilla = document.querySelector('[data-testid="monitor-grilla"]');
    const pasa = (el: Element) =>
      el.scrollHeight > el.clientHeight + 1 ||
      el.scrollWidth > el.clientWidth + 1;
    return !pasa(raiz) && grilla !== null && !pasa(grilla);
  });
}

test.describe("HU-038: monitor de Cocina", () => {
  test("[TC-E-091] HU-038: Cocina ve sin scroll ni botones las comandas en preparación y listas; las recibidas solo se cuentan", async ({
    context,
    kdsPageMozo,
    kdsPageCocina,
  }, testInfo) => {
    await kdsPageCocina.setViewportSize({ width: 1920, height: 1080 });
    const marca = `e2e-${testInfo.project.name}-${Date.now()}`;
    const enCurso = await crearPedido(context, `${marca}-1`);
    const recibido = await crearPedido(context, `${marca}-2`);

    // El mozo pasa uno a preparación; el otro queda recibido.
    await kdsPageMozo.reload();
    await comanda(kdsPageMozo, enCurso)
      .getByRole("button", { name: "Marcar en preparación" })
      .click();

    await kdsPageCocina.reload();
    const monitor = kdsPageCocina.getByTestId("monitor-cocina");
    await expect(monitor).toBeVisible({ timeout: 15000 });

    // En preparación: tarjeta del monitor. Recibido: sin tarjeta.
    const tarjeta = comanda(kdsPageCocina, enCurso);
    await expect(tarjeta).toBeVisible({ timeout: 10000 });
    await expect(tarjeta).toHaveAttribute("data-variante", "monitor");
    await expect(tarjeta).toContainText("En preparación");
    await expect(comanda(kdsPageCocina, recibido)).toHaveCount(0);

    // Resumen grande, con al menos los pedidos de este test.
    await expect(monitor.getByTestId("monitor-en-preparacion")).toContainText(
      "En preparación",
    );
    await expect(monitor.getByTestId("monitor-listos")).toContainText("Listos");
    const enEspera = monitor.getByTestId("monitor-en-espera");
    await expect(enEspera).toContainText("En espera");
    expect(
      Number(/(\d+)\s*$/.exec((await enEspera.textContent()) ?? "")?.[1]),
    ).toBeGreaterThanOrEqual(1);

    // Solo lectura y sin scroll.
    await expect(monitor.getByRole("button")).toHaveCount(0);
    expect(await sinScroll(kdsPageCocina)).toBe(true);

    // El mozo lo marca listo: Cocina lo ve en vivo, sin recargar.
    await comanda(kdsPageMozo, enCurso)
      .getByRole("button", { name: "Listo para entregar" })
      .click();
    await expect(tarjeta).toContainText("Listo para entregar", {
      timeout: 10000,
    });

    // Entregado: sale del monitor. HU-040 (BL-210): el pedido del enlace web
    // es para retirar y se entrega con su código.
    await entregarRetiroConCodigo(kdsPageMozo, comanda(kdsPageMozo, enCurso));
    await expect(tarjeta).toHaveCount(0, { timeout: 10000 });
    expect(await sinScroll(kdsPageCocina)).toBe(true);
  });

  test("[TC-E-092] HU-038: el monitor de Cocina no tiene errores graves de accesibilidad (axe)", async ({
    context,
    kdsPageMozo,
    kdsPageCocina,
  }, testInfo) => {
    await kdsPageCocina.setViewportSize({ width: 1920, height: 1080 });
    const pedidoId = await crearPedido(
      context,
      `e2e-${testInfo.project.name}-${Date.now()}`,
    );
    await kdsPageMozo.reload();
    await comanda(kdsPageMozo, pedidoId)
      .getByRole("button", { name: "Marcar en preparación" })
      .click();

    await kdsPageCocina.reload();
    await expect(comanda(kdsPageCocina, pedidoId)).toBeVisible({
      timeout: 15000,
    });

    // Solo la pantalla del KDS (<main>), como el resto de los specs con axe:
    // el botón de versión del layout (VersionInfo) queda fuera.
    const resultados = await new AxeBuilder({ page: kdsPageCocina })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  });
});
