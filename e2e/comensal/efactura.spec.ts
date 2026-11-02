import { test, expect } from "../support/auth";
import type { Page } from "@playwright/test";
import { ITEM_DISPONIBLE, KDS_PATH, MESA_ID } from "../support/ids";
import { intentarEntregarPedido } from "../support/kds";
import { continuarAlPago } from "../support/pago";

// HU-009 (BL-453): el comensal pide e-Factura con RUT y razón social en la
// pantalla de pago.
//
// - Con el RUT y la razón social cargados y sin aceptar el aviso de
//   privacidad, no se avisa al mozo: tiene que aceptarlo, borrar los datos
//   o desmarcar la e-Factura. Al desmarcarla, los datos no se mandan
//   (receptorFiscal: null) y se emite un e-Ticket.
// - Con el aviso aceptado y un RUT inválido, no se avisa al mozo hasta
//   corregirlo.
//
// Se usa el pago en efectivo de la mesa (no depende del sandbox de Mercado
// Pago). Necesita el efectivo habilitado en el establecimiento del seed
// (valor por defecto). Los pedidos avisados se cobran y se entregan desde el
// KDS al terminar.

const COBROS_PATH = "/admin/cobros";
// RUT de ejemplo con dígito verificador válido (no es de un contribuyente
// real); el inválido cambia solo el verificador.
const RUT_VALIDO = "21.999983.001-9";
const RUT_INVALIDO = "21.999983.001-8";
const RAZON_SOCIAL = "Comensal de Prueba E2E SAS";

const codigoDelPedido = (pedidoId: string) =>
  `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

/** Arma un pedido desde el QR de la mesa y elige pagar en efectivo. */
async function pedidoEnEfectivo(page: Page, rutaQr: string): Promise<string> {
  await page.goto(rutaQr);
  await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
  await page
    .getByRole("button", {
      name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
    })
    .click();
  const pedidoId = await continuarAlPago(page);
  const efectivo = page.getByRole("radio", { name: /Efectivo/ });
  await expect(efectivo).toBeVisible({ timeout: 10000 });
  await efectivo.check();
  return pedidoId;
}

/** Marca «Quiero e-Factura con RUT» y completa RUT y razón social. */
async function completarFactura(page: Page, rut: string): Promise<void> {
  await page
    .getByRole("checkbox", { name: /Quiero e-Factura con RUT/ })
    .check();
  await page.getByLabel("RUT", { exact: true }).fill(rut);
  await page.getByLabel("Razón social", { exact: true }).fill(RAZON_SOCIAL);
}

/** El mozo cobra el pedido desde «Cobros pendientes» (best effort en el cierre). */
async function cobrarEnEfectivo(
  kdsPage: Page,
  pedidoId: string,
): Promise<void> {
  await kdsPage.goto(COBROS_PATH);
  const fila = kdsPage
    .getByRole("listitem")
    .filter({ hasText: `Pedido ${codigoDelPedido(pedidoId)}` });
  await expect(fila).toBeVisible({ timeout: 15000 });
  await fila.getByRole("button", { name: "Cobrar en efectivo" }).click();
  await kdsPage
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar cobro" })
    .click();
}

test.describe("BL-453: e-Factura con RUT y razón social", () => {
  test("[TC-E-063] HU-009: con RUT y razón social cargados y sin aceptar el aviso de privacidad no se avisa al mozo; al desmarcar la e-Factura se avisa sin enviar los datos", async ({
    page,
    kdsPageMozo,
    qrMesas,
  }) => {
    test.slow();
    let pedidoId: string | undefined;
    let avisado = false;
    try {
      pedidoId = await pedidoEnEfectivo(page, qrMesas.ruta(MESA_ID));
      await completarFactura(page, RUT_VALIDO);

      // El aviso tiene el enlace a la política y empieza sin aceptar.
      const aviso = page.getByRole("checkbox", {
        name: /Acepto que el local guarde mi RUT/,
      });
      await expect(aviso).not.toBeChecked();
      await expect(
        page.getByRole("link", { name: "Política de privacidad" }).first(),
      ).toHaveAttribute("href", /\/privacidad\?/);

      // Sin aceptar: no sale la solicitud, se explica qué hacer y el foco
      // va a la casilla.
      const solicitudes: string[] = [];
      page.on("request", (req) => {
        if (req.url().endsWith("/solicitud-efectivo")) {
          solicitudes.push(req.url());
        }
      });
      await page.getByRole("button", { name: "Avisar al mozo" }).click();
      await expect(
        page.getByRole("alert").filter({ hasText: /tenés que aceptar/ }),
      ).toBeVisible();
      await expect(aviso).toBeFocused();
      await expect(aviso).toHaveAttribute("aria-invalid", "true");
      expect(solicitudes).toHaveLength(0);

      // Desmarca la e-Factura: ahora sí avisa, sin el RUT ni la razón social.
      await page
        .getByRole("checkbox", { name: /Quiero e-Factura con RUT/ })
        .uncheck();
      const [solicitud] = await Promise.all([
        page.waitForRequest(
          (req) =>
            req
              .url()
              .endsWith(`/pedidos/${pedidoId}/pagos/solicitud-efectivo`) &&
            req.method() === "POST",
        ),
        page.getByRole("button", { name: "Avisar al mozo" }).click(),
      ]);
      avisado = true;

      const cuerpo = solicitud.postData() ?? "";
      expect(JSON.parse(cuerpo)).toMatchObject({ receptorFiscal: null });
      expect(cuerpo).not.toContain("999983");
      expect(cuerpo).not.toContain(RAZON_SOCIAL);
      await expect(
        page.getByRole("heading", { name: "Esperando al mozo" }),
      ).toBeVisible();
    } finally {
      if (pedidoId && avisado) {
        await cobrarEnEfectivo(kdsPageMozo, pedidoId).catch(() => undefined);
        await kdsPageMozo.goto(KDS_PATH).catch(() => undefined);
        await intentarEntregarPedido(kdsPageMozo, pedidoId);
      }
    }
  });

  test("[TC-E-064] HU-009: con el aviso aceptado y un RUT con dígito verificador incorrecto, no se avisa al mozo hasta corregirlo", async ({
    page,
    qrMesas,
  }) => {
    await pedidoEnEfectivo(page, qrMesas.ruta(MESA_ID));
    await completarFactura(page, RUT_INVALIDO);
    await page
      .getByRole("checkbox", { name: /Acepto que el local guarde mi RUT/ })
      .check();

    let solicitudes = 0;
    page.on("request", (req) => {
      if (req.url().endsWith("/solicitud-efectivo")) solicitudes += 1;
    });
    await page.getByRole("button", { name: "Avisar al mozo" }).click();

    const rut = page.getByLabel("RUT", { exact: true });
    await expect(rut).toHaveAttribute("aria-invalid", "true");
    await expect(rut).toBeFocused();
    await expect(
      page.getByText(/el último dígito \(verificador\) no corresponde/),
    ).toBeVisible();
    expect(solicitudes).toBe(0);
  });
});
