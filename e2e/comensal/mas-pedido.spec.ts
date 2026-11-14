import AxeBuilder from "@axe-core/playwright";
// BL-477: `test` de support/auth trae el fixture pedidosDeTest, que cierra
// al terminar el pedido que crea el test.
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MENU_URL_PATH } from "../support/ids";
import { confirmarYPagar } from "../support/pago";

// HU-045 (BL-549): insignia «Más pedido», calculada con ventas reales (los 3
// platos con más unidades del local en 30 días, con al menos 10).
//
// El comensal compra 10 unidades de un plato y paga con la tarjeta de prueba:
// el resumen de ventas se recalcula al aprobarse el pago, así que no hace
// falta esperar al job. No se fija qué plato lleva la insignia: en staging
// los E2E venden siempre los mismos platos y el top 3 cambia.

const EXPLICACION =
  "Entre los 3 platos más pedidos del local en los últimos 30 días";

test.describe("BL-543: Insignia «Más pedido»", () => {
  test("[TC-E-118] HU-045: después de una venta de 10 unidades, el menú muestra la insignia «Más pedido» con su explicación (sin errores graves de accesibilidad)", async ({
    page,
  }) => {
    test.slow();
    await page.goto(MENU_URL_PATH);
    const agregar = page.getByRole("button", {
      name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
    });
    for (let i = 0; i < 10; i++) await agregar.click();
    // El botón muestra cuántas unidades hay en el carrito.
    await expect(agregar).toContainText("10 en el pedido");

    await confirmarYPagar(page);

    // La carta vuelve a pedir el menú, con el ranking actualizado.
    await page.goto(MENU_URL_PATH);
    const insignia = page.getByTitle(EXPLICACION).first();
    await expect(insignia).toBeVisible({ timeout: 15000 });
    await expect(insignia).toContainText("Más pedido");
    // El lector de pantalla oye de dónde sale (texto solo para lectores).
    await expect(insignia).toContainText(EXPLICACION);

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
