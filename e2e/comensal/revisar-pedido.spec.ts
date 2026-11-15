import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
// BL-477: `test` de support/auth trae el fixture pedidosDeTest, que cierra
// al terminar el pedido que crea TC-E-119.
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MENU_URL_PATH } from "../support/ids";
import { confirmarYPagar } from "../support/pago";

// BL-378: antes de confirmar, el comensal revisa el pedido y puede cambiar la
// cantidad de cada plato o quitarlo, en la hoja del celular y en la columna
// de escritorio. «Seguir viendo la carta» es el «agregar algo más».

const CELULAR = { width: 360, height: 800 };
const ESCRITORIO = { width: 1280, height: 800 };

const botonAgregar = (page: Page) =>
  page.getByRole("button", {
    name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
  });

async function agregar(page: Page, veces: number) {
  await page.goto(MENU_URL_PATH);
  await expect(page.getByText(ITEM_DISPONIBLE).first()).toBeVisible();
  for (let i = 0; i < veces; i++) await botonAgregar(page).click();
}

async function sinErroresGraves(page: Page, selector: string) {
  const resultados = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    resultados.violations
      .filter((v) => v.impact === "critical" || v.impact === "serious")
      .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
}

/** Los tres botones de la línea, con nombre accesible y 44 × 44 px. */
async function controlesDeLinea(detalle: Locator) {
  const restar = detalle.getByRole("button", {
    name: `Quitar uno de ${ITEM_DISPONIBLE}`,
  });
  const sumar = detalle.getByRole("button", {
    name: `Agregar uno de ${ITEM_DISPONIBLE}`,
  });
  const quitar = detalle.getByRole("button", {
    name: `Quitar ${ITEM_DISPONIBLE} del pedido`,
  });
  for (const boton of [restar, sumar, quitar]) {
    const caja = await boton.boundingBox();
    expect(caja?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(caja?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
  return { restar, sumar, quitar };
}

test.describe("BL-378: revisar el pedido antes de confirmar", () => {
  test.describe("en el celular", () => {
    test.use({ viewport: CELULAR });

    test("[TC-E-119] HU-003: en la hoja del pedido se cambia la cantidad, se sigue viendo la carta y se confirma y paga (sin errores graves de accesibilidad)", async ({
      page,
    }) => {
      test.slow();
      await agregar(page, 2);
      await page.getByTestId("carrito-barra").click();
      const hoja = page.getByTestId("carrito-hoja");
      await expect(hoja.getByText(`2x ${ITEM_DISPONIBLE}`)).toBeVisible();

      const { restar, sumar } = await controlesDeLinea(hoja);
      await restar.click();
      await expect(hoja.getByText(`1x ${ITEM_DISPONIBLE}`)).toBeVisible();
      await expect(page.locator("output[aria-live]")).toContainText(
        `Quitaste una unidad de ${ITEM_DISPONIBLE}`,
      );
      await sumar.click();
      await expect(hoja.getByText(`2x ${ITEM_DISPONIBLE}`)).toBeVisible();

      // Sin scroll horizontal y sin errores graves en la hoja.
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
      ).toBe(false);
      await sinErroresGraves(page, '[data-testid="carrito-hoja"]');

      // «Seguir viendo la carta»: el carrito queda igual.
      await hoja
        .getByRole("button", { name: "Seguir viendo la carta" })
        .click();
      await expect(hoja).toBeHidden();
      await expect(botonAgregar(page)).toContainText("2 en el pedido");

      await confirmarYPagar(page);
    });

    test("[TC-E-120] HU-003: al quitar el último plato desde la hoja, el pedido queda vacío y la hoja se cierra", async ({
      page,
    }) => {
      await agregar(page, 1);
      await page.getByTestId("carrito-barra").click();
      const hoja = page.getByTestId("carrito-hoja");
      const { quitar } = await controlesDeLinea(hoja);

      await quitar.click();

      await expect(hoja).toBeHidden();
      await expect(page.getByTestId("carrito-barra")).toHaveCount(0);
      await expect(botonAgregar(page)).not.toContainText("en el pedido");
      await expect(page.locator("output[aria-live]")).toContainText(
        "Tu pedido quedó vacío.",
      );
    });
  });

  test.describe("en escritorio", () => {
    test.use({ viewport: ESCRITORIO });

    test("[TC-E-121] HU-003: en la columna del pedido se cambia la cantidad y se quita un plato", async ({
      page,
    }) => {
      await agregar(page, 1);
      const columna = page.getByRole("complementary").filter({
        hasText: "Continuar al pago",
      });
      await expect(columna.getByText(`1x ${ITEM_DISPONIBLE}`)).toBeVisible();

      const { sumar, quitar } = await controlesDeLinea(columna);
      await sumar.click();
      await expect(columna.getByText(`2x ${ITEM_DISPONIBLE}`)).toBeVisible();
      await sinErroresGraves(page, "aside");

      await quitar.click();
      await expect(columna).toHaveCount(0);
      await expect(botonAgregar(page)).not.toContainText("en el pedido");
    });
  });
});
