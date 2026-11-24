import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MENU_URL_PATH } from "../support/ids";
import { continuarAlPago } from "../support/pago";

// HU-011 (BL-488): BistroLink le manda al POS del local las ventas que cobra.
//
// El administrador activa el envío en «POS del local» (/admin/pos), el
// comensal arma un pedido para retirar, el administrador lo cobra con el POS
// desde «Cobros pendientes» y la venta aparece en /admin/pos como «En el
// POS». En CI y en staging el backend usa el POS de prueba (POS_ADAPTER=mock,
// el default), así que no se llama a ningún sistema externo.
//
// Cambia una opción de TODO el establecimiento del seed (si manda o no las
// ventas al POS). No afecta a los otros specs (encolar la venta no cambia
// nada del pedido), pero se deja como estaba en el `finally`.
//
// BL-477: al terminar, el pedido lo cierra el fixture pedidosDeTest (si la
// venta ya está en el POS, eso la anula; es lo esperado).

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const POS_PATH = "/admin/pos";
const COBROS_PATH = "/admin/cobros";
const CONFIGURACION_POS = "/admin/pos/configuracion";

const codigoDelPedido = (pedidoId: string) =>
  `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

/** Abre /admin/pos y devuelve el Bearer y si el envío estaba activado. */
async function abrirPos(
  page: Page,
): Promise<{ authorization: string; habilitada: boolean }> {
  const [respuesta] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith("/admin/pos/sincronizaciones") &&
        r.request().method() === "GET" &&
        Boolean(r.request().headers()["authorization"]),
    ),
    page.goto(POS_PATH),
  ]);
  expect(respuesta.status()).toBe(200);
  const datos = (await respuesta.json()) as { habilitada: boolean };
  return {
    authorization: respuesta.request().headers()["authorization"],
    habilitada: datos.habilitada,
  };
}

test.describe("BL-488: ventas al POS del local", () => {
  test("[TC-E-083] HU-011: el administrador activa el envío al POS, cobra un pedido con el POS y ve la venta «En el POS» en /admin/pos, sin errores graves de accesibilidad", async ({
    page,
    kdsPageAdmin,
  }) => {
    test.slow();
    const admin = kdsPageAdmin;
    const { authorization, habilitada } = await abrirPos(admin);

    try {
      // 1. Activa el envío con el switch (si ya estaba, lo apaga y prende).
      const envio = admin.getByRole("switch", {
        name: "Mandar las ventas al POS",
      });
      await expect(envio).toBeEnabled();
      if (habilitada) {
        await envio.click();
        await expect(envio).toHaveAttribute("aria-checked", "false");
      }
      const [patch] = await Promise.all([
        admin.waitForResponse(
          (r) =>
            r.url().endsWith(CONFIGURACION_POS) &&
            r.request().method() === "PATCH",
        ),
        envio.click(),
      ]);
      expect(patch.status()).toBe(200);
      await expect(envio).toHaveAttribute("aria-checked", "true");
      await expect(admin.getByText("Envío al POS activado.")).toBeVisible();

      // 2. El comensal arma un pedido para retirar y no paga con tarjeta.
      await page.goto(MENU_URL_PATH);
      await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
      await page
        .getByRole("button", {
          name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
        })
        .click();
      const pedidoId = await continuarAlPago(page);
      const codigo = codigoDelPedido(pedidoId);

      // 3. El administrador lo cobra con el POS (crédito y autorización).
      await admin.goto(COBROS_PATH);
      const fila = admin
        .getByRole("listitem")
        .filter({ hasText: `Pedido ${codigo}` });
      await expect(fila).toBeVisible({ timeout: 15000 });
      await fila.getByRole("button", { name: "Cobrar con el POS" }).click();
      const dialogo = admin.getByRole("dialog");
      await dialogo.getByRole("radio", { name: "Crédito" }).check();
      await dialogo.getByLabel("Número de autorización").fill("e2e083");
      const [cobro] = await Promise.all([
        admin.waitForResponse(
          (r) =>
            r.url().endsWith("/cobros/pos") && r.request().method() === "POST",
        ),
        dialogo.getByRole("button", { name: "Registrar cobro" }).click(),
      ]);
      expect(cobro.status()).toBe(201);

      // 4. La venta llega al POS (se manda enseguida después del cobro).
      await expect(async () => {
        await admin.goto(POS_PATH);
        const venta = admin.getByRole("row").filter({ hasText: codigo });
        await expect(venta).toContainText("Venta", { timeout: 2000 });
        await expect(venta).toContainText("Para retirar");
        await expect(venta).toContainText("En el POS");
      }).toPass({ timeout: 20000 });

      const resultados = await new AxeBuilder({ page: admin })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        resultados.violations
          .filter((v) => v.impact === "critical" || v.impact === "serious")
          .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
    } finally {
      const res = await admin.request.patch(`${API_URL}${CONFIGURACION_POS}`, {
        headers: { authorization },
        data: { habilitada },
      });
      expect(res.status(), await res.text()).toBe(200);
    }
  });
});
