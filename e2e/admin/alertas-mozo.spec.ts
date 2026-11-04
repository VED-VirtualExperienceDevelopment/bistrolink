import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect } from "../support/auth";
import { tokenAdminDesdePanel } from "../support/qr-mesas";
import {
  crearMesaTemporal,
  eliminarMesaTemporal,
  type MesaTemporal,
} from "../support/mesa-temporal";

// BL-441: el personal del salón recibe los llamados de las mesas en la campana
// del encabezado (vista rápida) y en la pantalla Alertas del menú, y puede
// aceptarlos desde ahí. El tablero del KDS no los muestra.
//
// Usa solo la sesión de ADMIN (kdsPageAdmin): ve la misma campana y la misma
// pantalla que el mozo, y de ahí sale también el token para crear la mesa. No
// se combina con kdsPageMozo: los dos fixtures comparten el contexto del
// navegador, y con la sesión del primero abierta el segundo no pasa por el
// login.
//
// El test crea su propia mesa (support/mesa-temporal.ts) y la borra al
// terminar: el llamado agota el cupo de 1 por minuto de esa mesa, y así no
// depende de ninguna mesa del seed ni choca con otros specs. Puede haber
// otras alertas pendientes de otros specs: el test busca la de su mesa.

const KDS_ADMIN_PATH = "/admin/kds";
const ALERTAS_PATH = "/admin/alertas";

/** Errores graves o críticos de accesibilidad (axe, WCAG 2.1 AA) en `selector`. */
async function erroresGraves(page: Page, selector: string) {
  const resultados = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return resultados.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) }));
}

/**
 * El comensal llama al mozo desde el QR de la mesa y espera la confirmación
 * «Avisamos al mozo». Cierra su pestaña al terminar.
 */
async function llamarAlMozo(context: BrowserContext, mesa: MesaTemporal) {
  const mesaPage = await context.newPage();
  try {
    await mesaPage.goto(mesa.ruta);
    await mesaPage.getByRole("button", { name: /Llamar al mozo/i }).click();
    await expect(mesaPage.getByText(/Avisamos al mozo/i)).toBeVisible();
  } finally {
    await mesaPage.close();
  }
}

test.describe("BL-441: Alertas del mozo", () => {
  test("[TC-E-073] HU-019: el administrador ve el llamado de la mesa en la campana y en la pantalla Alertas, lo acepta y no hay errores graves de accesibilidad", async ({
    context,
    kdsPageAdmin: page,
  }) => {
    const authorization = await tokenAdminDesdePanel(page);
    let mesa: MesaTemporal | undefined;

    try {
      mesa = await crearMesaTemporal(context.request, authorization);

      await page.goto(KDS_ADMIN_PATH);
      await expect(
        page.getByRole("heading", { name: "Pedidos activos" }),
      ).toBeVisible();

      // El comensal llama al mozo desde el QR de la mesa.
      const mesaPage = await context.newPage();
      await mesaPage.goto(mesa.ruta);
      await mesaPage.getByRole("button", { name: /Llamar al mozo/i }).click();
      await expect(mesaPage.getByText(/Avisamos al mozo/i)).toBeVisible();

      // La campana del encabezado avisa que hay pendientes. El encabezado
      // está dentro de <main> (AdminShell), así que no tiene rol «banner».
      const campana = page
        .locator("main > header")
        .getByRole("button", { name: /^Alertas, \d+ pendientes?$/ });
      await expect(campana).toBeVisible({ timeout: 5000 });
      await expect(campana).toHaveAttribute("aria-expanded", "false");

      // Los llamados se atienden desde la campana y la pantalla Alertas: el
      // tablero no los muestra. Como la campana ya tiene el contador, el
      // evento ya llegó a esta página y la ausencia en el tablero es firme.
      const titulo = new RegExp(`Mesa ${mesa.numero} solicita atención`, "i");
      await expect(
        page.getByRole("alert").filter({ hasText: titulo }),
      ).toHaveCount(0);

      // La campana abre una vista rápida con la alerta de la mesa.
      await campana.click();
      const vistaRapida = page.getByRole("region", {
        name: "Alertas pendientes",
      });
      await expect(vistaRapida).toBeVisible();
      await expect(campana).toHaveAttribute("aria-expanded", "true");
      await expect(
        vistaRapida.getByRole("listitem").filter({ hasText: titulo }),
      ).toBeVisible();
      expect(await erroresGraves(page, "#vista-rapida-alertas")).toEqual([]);

      // Es pasajera: Esc la cierra y el foco vuelve a la campana.
      await page.keyboard.press("Escape");
      await expect(vistaRapida).toBeHidden();
      await expect(campana).toHaveAttribute("aria-expanded", "false");
      await expect(campana).toBeFocused();

      // «Alertas» es una pantalla del menú, con su propio contador.
      await page
        .getByRole("navigation")
        .getByRole("link", { name: /^Alertas/ })
        .click();
      await expect(page).toHaveURL(new RegExp(`${ALERTAS_PATH}$`));
      await expect(
        page.getByRole("heading", { name: "Alertas", level: 1 }),
      ).toBeVisible();
      await expect(
        page.getByRole("navigation").getByRole("link", { name: /^Alertas/ }),
      ).toHaveAttribute("aria-current", "page");

      const alerta = page
        .getByRole("main")
        .getByRole("listitem")
        .filter({ hasText: titulo });
      await expect(alerta).toBeVisible();
      await expect(
        alerta.getByRole("button", {
          name: `Desestimar la alerta de la mesa ${mesa.numero}`,
        }),
      ).toBeVisible();
      expect(await erroresGraves(page, "main")).toEqual([]);

      // Aceptar saca la alerta de la lista.
      await alerta
        .getByRole("button", {
          name: `Aceptar la alerta de la mesa ${mesa.numero}`,
        })
        .click();
      await expect(alerta).toBeHidden();
    } finally {
      // Deja el entorno como estaba: la mesa de prueba se borra.
      if (mesa) {
        await eliminarMesaTemporal(context.request, authorization, mesa.id);
      }
    }
  });

  test("[TC-E-074] HU-019: la alerta sin atender sigue en la pantalla Alertas después de recargar la página, y una alerta aceptada no vuelve", async ({
    context,
    kdsPageAdmin: page,
  }) => {
    const authorization = await tokenAdminDesdePanel(page);
    const mesas: MesaTemporal[] = [];

    try {
      // Dos mesas de prueba: la A se acepta y la B queda pendiente. La B
      // también sirve de señal: cuando se ve después de recargar, el servidor
      // ya mandó las alertas pendientes y se puede afirmar que la A no está.
      const mesaA = await crearMesaTemporal(context.request, authorization);
      mesas.push(mesaA);
      const mesaB = await crearMesaTemporal(context.request, authorization);
      mesas.push(mesaB);

      const tituloA = new RegExp(`Mesa ${mesaA.numero} solicita atención`, "i");
      const tituloB = new RegExp(`Mesa ${mesaB.numero} solicita atención`, "i");
      const alertaDe = (titulo: RegExp) =>
        page.getByRole("main").getByRole("listitem").filter({ hasText: titulo });

      await page.goto(ALERTAS_PATH);
      await expect(
        page.getByRole("heading", { name: "Alertas", level: 1 }),
      ).toBeVisible();

      await llamarAlMozo(context, mesaA);
      await llamarAlMozo(context, mesaB);
      await expect(alertaDe(tituloA)).toBeVisible({ timeout: 5000 });
      await expect(alertaDe(tituloB)).toBeVisible();

      // Recargar sin haber hecho nada con las alertas: siguen ahí.
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Alertas", level: 1 }),
      ).toBeVisible();
      await expect(alertaDe(tituloA)).toBeVisible({ timeout: 10000 });
      await expect(alertaDe(tituloB)).toBeVisible();

      // Se acepta la de la mesa A y se recarga de nuevo.
      await alertaDe(tituloA)
        .getByRole("button", {
          name: `Aceptar la alerta de la mesa ${mesaA.numero}`,
        })
        .click();
      await expect(alertaDe(tituloA)).toBeHidden();

      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Alertas", level: 1 }),
      ).toBeVisible();
      // La B confirma que las alertas ya llegaron; la A no tiene que estar.
      await expect(alertaDe(tituloB)).toBeVisible({ timeout: 10000 });
      await expect(alertaDe(tituloA)).toHaveCount(0);
    } finally {
      // Deja el entorno como estaba: cerrar la mesa también limpia su alerta.
      for (const mesa of mesas) {
        await eliminarMesaTemporal(context.request, authorization, mesa.id);
      }
    }
  });
});
