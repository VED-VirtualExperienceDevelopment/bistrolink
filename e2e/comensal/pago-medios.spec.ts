import type { Page } from "@playwright/test";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MESA_ID } from "../support/ids";
import { continuarAlPago } from "../support/pago";
import {
  abrirConfiguracion,
  cambiarMediosDePago,
  type MediosDePago,
} from "../support/configuracion";

// BL-452: el comensal ve solo los medios de pago que el local tiene
// habilitados en su configuración (HU-020): tarjeta (Mercado Pago) y
// efectivo.
//
// Cada test cambia los medios del establecimiento del seed por la API y los
// deja como estaban en el `finally`. Como eso afecta a todo el
// establecimiento, este spec corre en su propio proyecto
// (`chromium-configuracion`), después de `chromium`, y en serie.
//
// Los pedidos quedan en PENDIENTE_PAGO (no se paga): no llegan a cocina y se
// cancelan al cerrar la mesa (HU-017).

test.describe.configure({ mode: "serial" });

test.describe("BL-452: medios de pago del comensal según la configuración del local", () => {
  /** Arma un pedido en la mesa del seed y llega a «Pagá tu pedido». */
  async function irAPagarDesdeLaMesa(page: Page, rutaQr: string) {
    await page.goto(rutaQr);
    await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
    await page
      .getByRole("button", {
        name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
      })
      .click();
    await continuarAlPago(page);
  }

  /** Cambia los medios, corre el test y deja la configuración como estaba. */
  async function conMedios(
    adminPage: Page,
    medios: Partial<MediosDePago>,
    prueba: () => Promise<void>,
  ) {
    const { authorization, original } = await abrirConfiguracion(adminPage);
    try {
      await cambiarMediosDePago(adminPage, authorization, medios);
      await prueba();
    } finally {
      await cambiarMediosDePago(adminPage, authorization, original);
    }
  }

  test("[TC-E-056] BL-452: con Mercado Pago deshabilitado, el comensal en la mesa ve solo el pago en efectivo", async ({
    page,
    kdsPageAdmin,
    qrMesas,
  }) => {
    await conMedios(
      kdsPageAdmin,
      { efectivoHabilitado: true, mercadoPagoHabilitado: false },
      async () => {
        await irAPagarDesdeLaMesa(page, qrMesas.ruta(MESA_ID));

        // Primero lo que tiene que estar (espera a que carguen los medios)...
        await expect(page.getByLabel("¿Con cuánto vas a pagar?")).toBeVisible({
          timeout: 10000,
        });
        await expect(
          page.getByRole("button", { name: "Avisar al mozo" }),
        ).toBeVisible();
        // ...y después lo que no: ni la tarjeta ni el selector.
        await expect(
          page.getByRole("heading", { name: "Tarjeta de débito o crédito" }),
        ).toHaveCount(0);
        await expect(page.getByRole("radio", { name: /Efectivo/ })).toHaveCount(
          0,
        );
      },
    );
  });

  test("[TC-E-057] BL-452: con el efectivo deshabilitado, el comensal en la mesa ve solo el pago con tarjeta (Mercado Pago)", async ({
    page,
    kdsPageAdmin,
    qrMesas,
  }) => {
    await conMedios(
      kdsPageAdmin,
      { efectivoHabilitado: false, mercadoPagoHabilitado: true },
      async () => {
        await irAPagarDesdeLaMesa(page, qrMesas.ruta(MESA_ID));

        await expect(
          page.getByRole("heading", { name: "Tarjeta de débito o crédito" }),
        ).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole("radio", { name: /Efectivo/ })).toHaveCount(
          0,
        );
        await expect(
          page.getByRole("button", { name: "Avisar al mozo" }),
        ).toHaveCount(0);
      },
    );
  });

  test("[TC-E-058] BL-452: sin medios habilitados, el comensal en la mesa ve el aviso para que le cobre el mozo", async ({
    page,
    kdsPageAdmin,
    qrMesas,
  }) => {
    await conMedios(
      kdsPageAdmin,
      { efectivoHabilitado: false, mercadoPagoHabilitado: false },
      async () => {
        await irAPagarDesdeLaMesa(page, qrMesas.ruta(MESA_ID));

        await expect(
          page.getByText(/Llamá al mozo para que te cobre/),
        ).toBeVisible({ timeout: 10000 });
        await expect(
          page.getByRole("button", { name: "Llamar al mozo" }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Tarjeta de débito o crédito" }),
        ).toHaveCount(0);
        await expect(page.getByLabel("¿Con cuánto vas a pagar?")).toHaveCount(
          0,
        );
      },
    );
  });
});
