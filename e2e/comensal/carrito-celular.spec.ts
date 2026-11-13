import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MENU_URL_PATH } from "../support/ids";

// BL-519: en el celular el carrito no tapa la carta. Es una barra de una
// línea (cantidad, «Ver pedido» y total) y el detalle se abre en una hoja.
// Desde lg sigue siendo la columna de la derecha.
//
// Usa la carta por URL (pedido web): no crea pedidos ni toca mesas.

const CELULAR = { width: 390, height: 844 };
const ESCRITORIO = { width: 1280, height: 800 };

const botonAgregar = (page: Page) =>
  page.getByRole("button", {
    name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
  });

async function agregarUnPlato(page: Page) {
  await page.goto(MENU_URL_PATH);
  await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
  await botonAgregar(page).click();
}

test.describe("BL-519: carrito del comensal en el celular", () => {
  test.use({ viewport: CELULAR });

  test("[TC-E-105] HU-003: en el celular el carrito es una barra de una línea y el detalle se abre en una hoja", async ({
    page,
  }) => {
    await agregarUnPlato(page);

    const barra = page.getByTestId("carrito-barra");
    await expect(barra).toBeVisible();
    await expect(barra).toContainText("Ver pedido");
    // La barra ocupa poco: la carta sigue a la vista.
    const caja = await barra.boundingBox();
    expect(caja?.height ?? CELULAR.height).toBeLessThan(CELULAR.height * 0.12);
    await expect(
      page.getByRole("button", { name: "Continuar al pago" }),
    ).toBeHidden();
    await expect(botonAgregar(page)).toContainText("1 en el pedido");

    await barra.click();
    const hoja = page.getByRole("dialog", { name: /Tu pedido/ });
    await expect(hoja).toBeVisible();
    await expect(hoja.getByText(`1x ${ITEM_DISPONIBLE}`)).toBeVisible();
    await expect(hoja.getByLabel("Instrucciones generales")).toBeVisible();
    await expect(
      hoja.getByRole("button", { name: "Continuar al pago" }),
    ).toBeVisible();

    await hoja.getByRole("button", { name: "Seguir viendo la carta" }).click();
    await expect(hoja).toBeHidden();
    await expect(barra).toBeFocused();
  });

  test("[TC-E-106] HU-003: la hoja del pedido es accesible y se cierra con Escape", async ({
    page,
  }) => {
    await agregarUnPlato(page);
    const barra = page.getByTestId("carrito-barra");
    await barra.click();
    const hoja = page.getByRole("dialog", { name: /Tu pedido/ });
    await expect(hoja).toBeVisible();
    await expect(
      hoja.getByRole("button", { name: "Cerrar el pedido" }),
    ).toBeFocused();

    const resultados = await new AxeBuilder({ page })
      .include('[data-testid="carrito-hoja"]')
      .analyze();
    const violacionesCriticas = resultados.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(violacionesCriticas).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(hoja).toBeHidden();
    await expect(barra).toBeFocused();
  });
});

test.describe("BL-519: carrito del comensal en escritorio", () => {
  test.use({ viewport: ESCRITORIO });

  test("[TC-E-107] HU-003: en escritorio el carrito sigue en la columna de la derecha, sin barra", async ({
    page,
  }) => {
    await agregarUnPlato(page);

    await expect(page.getByText(/Tu pedido \(1 item\)/i)).toBeVisible();
    await expect(page.getByText(`1x ${ITEM_DISPONIBLE}`)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continuar al pago" }),
    ).toBeVisible();
    await expect(page.getByTestId("carrito-barra")).toHaveCount(0);
  });
});
