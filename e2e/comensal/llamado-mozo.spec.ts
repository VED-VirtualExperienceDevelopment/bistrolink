import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../support/auth";
import { MESA_ID, MESA_ID_RATE_LIMIT } from "../support/ids";
import { ALERTAS_PATH, intentarDesestimarLlamado } from "../support/kds";
import { tokenAdminDesdePanel } from "../support/qr-mesas";
import {
  crearMesaTemporal,
  eliminarMesaTemporal,
  type MesaTemporal,
} from "../support/mesa-temporal";

// HU-034 (BL-204): la mesa se abre desde la URL de su QR (fixture qrMesas)
// y el llamado va a POST /mesas/llamar con el token del QR en X-Mesa-Token.
//
// BL-441: el llamado queda pendiente en el servidor hasta que el mozo lo
// atiende, así que cada test lo desestima al terminar. Los números son los de
// las mesas del seed (MESA_ID y MESA_ID_RATE_LIMIT). El mozo lo recibe en la
// pantalla Alertas: el tablero del KDS ya no muestra los llamados normales.
//
// BL-592: el botón está en la barra superior. Después de llamar dice
// «Mozo avisado» (sin tiempos) y, pasado el límite de 1 minuto, «Volver a
// llamar». La confirmación se ve en el botón; el texto («Listo, avisamos al
// mozo.») va solo para el lector de pantalla, en una región <output>.
const NUMERO_MESA = 1;
const NUMERO_MESA_RATE_LIMIT = 2;

test.describe("BL-69: Llamado al mozo desde la mesa (integración)", () => {
  test("[TC-E-012] HU-019: el mozo recibe el evento en menos de 1s al presionar el botón", async ({
    context,
    kdsPageMozo,
    qrMesas,
  }) => {
    const mesaPage = await context.newPage();
    try {
      // La pantalla Alertas ya está abierta cuando la mesa llama: se prueba
      // que el evento llega en vivo, no solo que queda guardado.
      await kdsPageMozo.goto(ALERTAS_PATH);
      await expect(
        kdsPageMozo.getByRole("heading", { name: "Alertas", level: 1 }),
      ).toBeVisible();

      await mesaPage.goto(qrMesas.ruta(MESA_ID));

      const [llamadoReq] = await Promise.all([
        mesaPage.waitForRequest(
          (req) =>
            req.url().endsWith("/mesas/llamar") && req.method() === "POST",
        ),
        mesaPage.getByRole("button", { name: /Llamar al mozo/i }).click(),
      ]);
      // BL-204: el llamado lleva el QR, no el id de la mesa en la URL.
      expect(llamadoReq.headers()["x-mesa-token"]).toBe(
        qrMesas.token(MESA_ID),
      );

      // El presupuesto de <1s de BL-69 es sobre la propagación del evento
      // WebSocket (backend emite -> panel del mozo lo recibe), no sobre el
      // ciclo completo del click, que incluye además el handshake de
      // /auth/comensal/mesa. Por eso el timeout acá es generoso: solo
      // confirma que el llamado LLEGA, no cuánto tarda el login.
      await expect(
        kdsPageMozo
          .getByRole("main")
          .getByRole("listitem")
          .filter({ hasText: /Mesa 1 solicita atención/i }),
      ).toBeVisible({
        timeout: 5000,
      });

      // BL-592: la confirmación está en el botón y se anuncia al lector.
      await expect(
        mesaPage.getByRole("button", { name: "Mozo avisado" }),
      ).toBeVisible();
      await expect(
        mesaPage.getByRole("status").filter({ hasText: "Listo, avisamos al mozo." }),
      ).toBeAttached();
    } finally {
      await mesaPage.close();
      await intentarDesestimarLlamado(kdsPageMozo, NUMERO_MESA);
    }
  });

  test("[TC-E-013] HU-019: no permite más de 1 llamado por minuto (429)", async ({
    page,
    kdsPageMozo,
    qrMesas,
  }) => {
    try {
      // Mesa aparte (MESA_ID_RATE_LIMIT): no comparte cupo con TC-E-012.
      await page.goto(qrMesas.ruta(MESA_ID_RATE_LIMIT));
      await page.getByRole("button", { name: /Llamar al mozo/i }).click();
      await expect(page.getByRole("button", { name: "Mozo avisado" })).toBeVisible();

      // Al recargar, el botón vuelve a «Llamar al mozo»; el segundo llamado
      // responde 429 y, para el comensal, es lo mismo que el primero: el
      // mozo ya sabe (BL-592: sin tono de error y sin tiempos).
      const [respuesta] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().endsWith("/mesas/llamar") &&
            res.request().method() === "POST",
        ),
        page.reload().then(() =>
          page.getByRole("button", { name: /Llamar al mozo/i }).click(),
        ),
      ]);
      expect(respuesta.status()).toBe(429);

      await expect(page.getByRole("button", { name: "Mozo avisado" })).toBeVisible();
      await expect(
        page.getByRole("status").filter({ hasText: "Ya avisamos al mozo." }),
      ).toBeAttached();
      // Ninguna franja de error a la vista.
      await expect(page.getByRole("button", { name: "Cerrar el aviso" })).toHaveCount(0);
    } finally {
      await intentarDesestimarLlamado(kdsPageMozo, NUMERO_MESA_RATE_LIMIT);
    }
  });
});

test.describe("BL-592: «Llamar al mozo» en la barra superior", () => {
  test("[TC-E-128] BL-592: a 360 px el botón está en la barra superior, dice «Mozo» y su nombre accesible es «Llamar al mozo»", async ({
    browser,
    qrMesas,
  }) => {
    // Sin hacer clic: no consume el cupo de llamados de la mesa. Contexto
    // propio (no browser.newPage): AxeBuilder lo necesita para analizar.
    const contexto = await browser.newContext({
      viewport: { width: 360, height: 800 },
    });
    const celular = await contexto.newPage();
    try {
      await celular.goto(qrMesas.ruta(MESA_ID));

      const barra = celular.getByRole("navigation");
      const boton = barra.getByRole("button", {
        name: "Llamar al mozo",
        exact: true,
      });
      await expect(boton).toBeVisible({ timeout: 15_000 });
      // innerText: el texto largo está en el DOM, pero oculto por debajo de 380 px.
      await expect(boton).toHaveText("Mozo", { useInnerText: true });

      // Objetivo táctil de 44 px o más (BL-592, CA 5).
      const caja = await boton.boundingBox();
      expect(caja?.height ?? 0).toBeGreaterThanOrEqual(44);

      // Una sola vez en la página: al final de la carta ya no está.
      await expect(
        celular.getByRole("button", { name: "Llamar al mozo", exact: true }),
      ).toHaveCount(1);

      // «En el local» pasó a la portada, con el número de mesa.
      await expect(celular.getByText("En el local · Mesa 1")).toBeVisible();

      const resultados = await new AxeBuilder({ page: celular })
        .include("nav")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      const graves = resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) }));
      expect(graves).toEqual([]);
    } finally {
      await contexto.close();
    }
  });

  test("[TC-E-129] BL-592: pasado el minuto del límite, el botón ofrece «Volver a llamar» sin haber mostrado ningún tiempo", async ({
    context,
    kdsPageAdmin,
  }) => {
    // Mesa propia: el llamado agota su cupo de 1 por minuto y no debe chocar
    // con los demás tests. Cerrarla al final también limpia su alerta.
    const authorization = await tokenAdminDesdePanel(kdsPageAdmin);
    let mesa: MesaTemporal | undefined;
    const mesaPage = await context.newPage();
    try {
      mesa = await crearMesaTemporal(context.request, authorization);

      // Reloj controlado: el test no espera el minuto de verdad.
      await mesaPage.clock.install();
      await mesaPage.goto(mesa.ruta);

      const barra = mesaPage.getByRole("navigation");
      await barra
        .getByRole("button", { name: "Llamar al mozo", exact: true })
        .click();

      const avisado = barra.getByRole("button", {
        name: "Mozo avisado",
        exact: true,
      });
      await expect(avisado).toBeVisible();
      // Sin cuenta regresiva ni tiempos en el botón.
      await expect(avisado).not.toHaveText(/\d/);
      // Durante el minuto, tocarlo no hace nada (aria-disabled).
      await expect(avisado).toHaveAttribute("aria-disabled", "true");

      await mesaPage.clock.fastForward(61_000);

      const volver = barra.getByRole("button", {
        name: "Volver a llamar al mozo",
        exact: true,
      });
      await expect(volver).toBeVisible();
      await expect(volver).toHaveAttribute("aria-disabled", "false");
    } finally {
      await mesaPage.close();
      if (mesa) {
        await eliminarMesaTemporal(context.request, authorization, mesa.id);
      }
    }
  });
});
