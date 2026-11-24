import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MENU_URL_PATH } from "../support/ids";
import {
  continuarAlPago,
  llenarCampoSeguro,
  TARJETA_PRUEBA,
} from "../support/pago";

// HU-051 (BL-563): sello de pago seguro en el pago con tarjeta. Las
// tarjetas las informa Mercado Pago (sandbox en staging): el test no fija
// cuáles son, solo que cada una tenga nombre y que la de la tarjeta de
// prueba (Mastercard) se resalte al escribir el número. El pedido queda
// pendiente y vence solo (HU-032).

test.use({ viewport: { width: 360, height: 800 } });

test("[TC-E-126] HU-051: el pago con tarjeta muestra «Pago seguro con» el logo de Mercado Pago y las tarjetas aceptadas, y resalta la marca al escribir el número (sin errores graves de accesibilidad)", async ({
  page,
}) => {
  test.info().setTimeout(test.info().timeout + 30_000);
  await page.goto(MENU_URL_PATH);
  await page
    .getByRole("button", {
      name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
    })
    .click();
  await continuarAlPago(page);

  // «Pago seguro con» y el logo de Mercado Pago, en una línea.
  await expect(page.getByText("Pago seguro con")).toBeVisible();
  await expect(page.getByRole("img", { name: "Mercado Pago" })).toBeVisible();
  const tarjetas = page.getByRole("list", { name: "Tarjetas aceptadas" });
  await expect(tarjetas).toBeVisible({ timeout: 10_000 });
  const items = tarjetas.getByRole("listitem");
  expect(await items.count()).toBeGreaterThan(0);
  // Cada tarjeta se nombra: con la imagen (alt) o con el texto.
  for (const item of await items.all()) {
    const imagen = item.locator("img");
    const nombre =
      (await imagen.count()) > 0
        ? await imagen.getAttribute("alt")
        : await item.textContent();
    expect(nombre?.trim()).toBeTruthy();
  }

  // Al escribir el número, se resalta Mastercard y las demás se atenúan.
  await llenarCampoSeguro(
    page,
    "Número de tarjeta",
    "cardNumber",
    TARJETA_PRUEBA.numero,
  );
  const mastercard = items.filter({
    has: page.locator('img[alt^="Mastercard"]'),
  });
  const mastercardTexto = items.filter({ hasText: /^Mastercard/ });
  await expect(mastercard.or(mastercardTexto)).toHaveAttribute(
    "data-estado",
    "detectada",
  );

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    "scroll horizontal en 360 px",
  ).toBe(false);
  const resultados = await new AxeBuilder({ page })
    .include("form")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    resultados.violations
      .filter((v) => v.impact === "critical" || v.impact === "serious")
      .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
});
