import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MENU_URL_PATH, MESA_ID } from "../support/ids";
import { continuarAlPago } from "../support/pago";

// HU-036 (BL-206): la política de privacidad del local se abre desde la
// carta (mesa y carta web) y desde el formulario de pago, y muestra quién es
// el responsable de los datos (Ley 18.331).

test.describe("BL-206: Política de privacidad", () => {
  test("[TC-E-062] HU-036: la política de privacidad se abre desde la carta y desde el pago, con los datos del local", async ({
    page,
    qrMesas,
  }) => {
    // Desde la carta web.
    await page.goto(MENU_URL_PATH);
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
    await page.getByRole("link", { name: "Política de privacidad" }).click();
    await expect(
      page.getByRole("heading", { name: "Política de privacidad", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Razón social", { exact: true })).toBeVisible();
    await expect(page.getByText("RUT", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Tus derechos" }),
    ).toBeVisible();

    // Desde la mesa (QR) y el formulario de pago: el aviso aclara que el
    // correo y el documento van a Mercado Pago y enlaza la misma política.
    await page.goto(qrMesas.ruta(MESA_ID));
    await page
      .getByRole("button", {
        name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
      })
      .click();
    await continuarAlPago(page);
    await expect(page.getByText(/BistroLink no los guarda/)).toBeVisible();
    await page.getByRole("link", { name: "Política de privacidad" }).click();
    await expect(page).toHaveURL(/\/privacidad\?qr=/);
    await expect(page.getByText("Razón social", { exact: true })).toBeVisible();
  });
});
