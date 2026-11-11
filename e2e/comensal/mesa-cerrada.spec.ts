import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE } from "../support/ids";
import { tokenAdminDesdePanel } from "../support/qr-mesas";
import {
  crearMesaTemporal,
  eliminarMesaTemporal,
  type MesaTemporal,
} from "../support/mesa-temporal";

// BL-518: cuando el mozo cierra la mesa, la carta del comensal se entera sin
// recargar y muestra «Tu mesa se cerró».
//
// Cerrar una mesa del seed rompería a los demás specs que corren en
// paralelo: el test crea su propia mesa (support/mesa-temporal.ts) con el
// token del ADMIN y la borra al terminar.

const API_URL = process.env.API_URL ?? "http://localhost:3001";

test.describe("BL-518: Mesa cerrada", () => {
  test("[TC-E-104] BL-518: al cerrar la mesa, la carta abierta del comensal pasa a «Tu mesa se cerró» sin recargar y sin errores graves de accesibilidad; al recargar, el QR dice que la mesa está cerrada", async ({
    context,
    kdsPageAdmin,
  }) => {
    const authorization = await tokenAdminDesdePanel(kdsPageAdmin);
    let mesa: MesaTemporal | undefined;

    try {
      mesa = await crearMesaTemporal(context.request, authorization);

      // 1. El comensal tiene la carta abierta.
      const comensal = await context.newPage();
      await comensal.goto(mesa.ruta);
      await expect(comensal.getByText(ITEM_DISPONIBLE)).toBeVisible();

      // 2. El mozo cierra la mesa.
      const cerrar = await context.request.post(
        `${API_URL}/mesas/${mesa.id}/cerrar`,
        { headers: { authorization } },
      );
      expect(cerrar.ok()).toBe(true);

      // 3. Sin recargar, la carta pasa a «Tu mesa se cerró».
      const aviso = comensal.getByTestId("mesa-cerrada");
      await expect(
        aviso.getByRole("heading", { name: "Tu mesa se cerró" }),
      ).toBeVisible({ timeout: 10000 });
      await expect(aviso).toContainText("escaneá el QR de nuevo");
      await expect(comensal.getByText(ITEM_DISPONIBLE)).toHaveCount(0);

      const resultados = await new AxeBuilder({ page: comensal })
        .include('[data-testid="mesa-cerrada"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        resultados.violations
          .filter((v) => v.impact === "critical" || v.impact === "serious")
          .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
      ).toEqual([]);

      // 4. Al recargar, el QR dice que la mesa está cerrada (HU-017).
      await comensal.reload();
      await expect(comensal.getByText("Esta mesa está cerrada.")).toBeVisible();
    } finally {
      if (mesa) {
        await eliminarMesaTemporal(context.request, authorization, mesa.id);
      }
    }
  });
});
