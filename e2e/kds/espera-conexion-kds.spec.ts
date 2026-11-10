import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page, WebSocketRoute } from "@playwright/test";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MENU_URL_PATH } from "../support/ids";
import { confirmarYPagar } from "../support/pago";

// HU-038 (BL-208, BL-505): tiempo de espera de las comandas e indicador de
// conexión del KDS.
//
// El KDS se abre como MOZO (kdsPageMozo, en /kds): mozo-test pertenece al
// tenant de testing, el mismo donde se crea el pedido. El /kds abre su
// propio socket (KdsBoard), así que se puede cortar sin tocar el resto.
//
// - El tiempo se adelanta con el reloj de Playwright (page.clock): no hace
//   falta esperar 30, 60 o 120 minutos. Los umbrales son los del seed
//   (30/60/120; la limpieza de BL-481 los restablece).
// - El corte del socket se simula con routeWebSocket (y route para el
//   transporte polling de socket.io): el navegador sigue con red, como
//   cuando se cae el servidor. El corte de red se simula con setOffline.

/** El comensal arma y paga un pedido; devuelve su id. */
async function crearPedido(
  context: BrowserContext,
  marca: string,
): Promise<string> {
  const menuPage = await context.newPage();
  await menuPage.goto(MENU_URL_PATH);
  await expect(menuPage.getByText(ITEM_DISPONIBLE)).toBeVisible();
  await menuPage
    .getByRole("button", {
      name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
    })
    .click();
  await menuPage
    .getByLabel(/instrucciones generales|alergias/i)
    .fill(`[${marca}]`);
  const pedidoId = await confirmarYPagar(menuPage);
  await menuPage.close();
  return pedidoId;
}

const comanda = (kdsPage: Page, pedidoId: string) =>
  kdsPage.locator(`article[data-pedido-id="${pedidoId}"]`);

const indicador = (kdsPage: Page) => kdsPage.getByTestId("indicador-conexion");

/** Errores graves de accesibilidad (axe) en la página, sin los menores. */
async function erroresGravesAxe(page: Page) {
  // Solo la pantalla del KDS (<main>), como el resto de los specs con axe:
  // el botón de versión del layout (VersionInfo) queda fuera.
  const resultados = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return resultados.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) }));
}

/**
 * Corta y restablece el socket del KDS sin sacarle la red al navegador. Se
 * instala antes de recargar el KDS, así pasa por acá la conexión que abre.
 */
async function controlarSocket(kdsPage: Page) {
  let cortado = false;
  const abiertos: { pagina: WebSocketRoute; servidor: WebSocketRoute }[] = [];

  // socket.io empieza con HTTP (polling) y después pasa a WebSocket.
  await kdsPage.route(/\/socket\.io\/.*transport=polling/, (ruta) =>
    cortado ? ruta.abort("connectionrefused") : ruta.continue(),
  );
  await kdsPage.routeWebSocket(/\/socket\.io\//, (ws) => {
    if (cortado) {
      void ws.close();
      return;
    }
    abiertos.push({ pagina: ws, servidor: ws.connectToServer() });
  });

  return {
    async cortar() {
      cortado = true;
      for (const { pagina, servidor } of abiertos.splice(0)) {
        await servidor.close();
        await pagina.close();
      }
    },
    restablecer() {
      cortado = false;
    },
  };
}

test.describe("HU-038: tiempo de espera e indicador de conexión en el KDS", () => {
  test("[TC-E-087] HU-038: cada comanda muestra el tiempo de espera y cambia de nivel sola con el paso del tiempo", async ({
    context,
    kdsPageMozo,
  }, testInfo) => {
    const pedidoId = await crearPedido(
      context,
      `e2e-${testInfo.project.name}-${Date.now()}`,
    );

    // Reloj de prueba desde ahora; el KDS se recarga para usarlo.
    await kdsPageMozo.clock.install();
    await kdsPageMozo.reload();
    const ticket = comanda(kdsPageMozo, pedidoId);
    await expect(ticket).toBeVisible({ timeout: 15000 });

    await expect(ticket).toHaveAttribute("data-nivel-espera", "a-tiempo");
    await expect(ticket.getByTestId("nivel-espera")).toHaveText("A tiempo");
    await expect(ticket.getByTestId("tiempo-espera")).toHaveText(
      /^(Recién llegado|hace \d+ min)$/,
    );
    // La hora sale con el formato de es-UY: «Llegó 08:31 a. m.».
    await expect(ticket.getByText(/^Llegó \d{1,2}:\d{2}/)).toBeVisible();

    // Sin ningún evento del socket: solo pasa el tiempo.
    await kdsPageMozo.clock.fastForward("31:00");
    await expect(ticket).toHaveAttribute("data-nivel-espera", "atencion");
    await expect(ticket.getByTestId("nivel-espera")).toHaveText("Atención");
    await expect(ticket.getByTestId("tiempo-espera")).toHaveText(
      /^hace 3\d min$/,
    );

    await kdsPageMozo.clock.fastForward("30:00");
    await expect(ticket).toHaveAttribute("data-nivel-espera", "demorado");
    await expect(ticket.getByTestId("nivel-espera")).toHaveText("Demorado");
    await expect(ticket.getByTestId("tiempo-espera")).toHaveText(
      /^hace 1 h( \d+ min)?$/,
    );

    await kdsPageMozo.clock.fastForward("01:00:00");
    await expect(ticket).toHaveAttribute("data-nivel-espera", "demora-alta");
    await expect(ticket.getByTestId("nivel-espera")).toHaveText(/Demora alta/);
    await expect(ticket.getByTestId("tiempo-espera")).toHaveText(
      /^hace 2 h( \d+ min)?$/,
    );
  });

  test("[TC-E-088] HU-038: si se corta la conexión aparece «Reconectando…» y al volver se normaliza sin perder pedidos", async ({
    context,
    kdsPageMozo,
  }, testInfo) => {
    const marca = `e2e-${testInfo.project.name}-${Date.now()}`;
    const anterior = await crearPedido(context, `${marca}-1`);

    const socket = await controlarSocket(kdsPageMozo);
    await kdsPageMozo.reload();
    await expect(indicador(kdsPageMozo)).toHaveAttribute(
      "data-estado",
      "conectado",
      {
        timeout: 15000,
      },
    );
    await expect(indicador(kdsPageMozo)).toHaveText("Conectado");
    await expect(comanda(kdsPageMozo, anterior)).toBeVisible({
      timeout: 15000,
    });

    // Se cae el servidor (el navegador sigue con red).
    await socket.cortar();
    await expect(indicador(kdsPageMozo)).toHaveAttribute(
      "data-estado",
      "reconectando",
      {
        timeout: 10000,
      },
    );
    await expect(indicador(kdsPageMozo)).toHaveText("Reconectando…");
    // Las comandas que ya estaban siguen a la vista.
    await expect(comanda(kdsPageMozo, anterior)).toBeVisible();

    // Mientras no hay conexión, entra un pedido nuevo.
    const nuevo = await crearPedido(context, `${marca}-2`);

    // Vuelve el servidor: se reconecta solo, sin recargar la página.
    socket.restablecer();
    await expect(indicador(kdsPageMozo)).toHaveAttribute(
      "data-estado",
      "conectado",
      {
        timeout: 20000,
      },
    );
    await expect(comanda(kdsPageMozo, nuevo)).toBeVisible({ timeout: 10000 });
    await expect(comanda(kdsPageMozo, anterior)).toBeVisible();
  });

  test("[TC-E-089] HU-038: sin red el indicador pasa enseguida a «Desconectado» y vuelve a «Conectado» al recuperarla", async ({
    context,
    kdsPageMozo,
  }, testInfo) => {
    const pedidoId = await crearPedido(
      context,
      `e2e-${testInfo.project.name}-${Date.now()}`,
    );
    await kdsPageMozo.reload();
    await expect(indicador(kdsPageMozo)).toHaveAttribute(
      "data-estado",
      "conectado",
      {
        timeout: 15000,
      },
    );

    try {
      await context.setOffline(true);
      // Sin esperar la demora de 30 s.
      await expect(indicador(kdsPageMozo)).toHaveAttribute(
        "data-estado",
        "desconectado",
        {
          timeout: 5000,
        },
      );
      await expect(indicador(kdsPageMozo)).toHaveText("Desconectado");
      await expect(comanda(kdsPageMozo, pedidoId)).toBeVisible();
    } finally {
      await context.setOffline(false);
    }

    await expect(indicador(kdsPageMozo)).toHaveAttribute(
      "data-estado",
      "conectado",
      {
        timeout: 20000,
      },
    );
    await expect(comanda(kdsPageMozo, pedidoId)).toBeVisible();
  });

  test("[TC-E-090] HU-038: el KDS no tiene errores graves de accesibilidad (axe) en ningún nivel de espera ni sin conexión", async ({
    context,
    kdsPageMozo,
  }, testInfo) => {
    const pedidoId = await crearPedido(
      context,
      `e2e-${testInfo.project.name}-${Date.now()}`,
    );
    await kdsPageMozo.clock.install();
    await kdsPageMozo.reload();
    const ticket = comanda(kdsPageMozo, pedidoId);
    await expect(ticket).toBeVisible({ timeout: 15000 });
    await expect(indicador(kdsPageMozo)).toHaveAttribute(
      "data-estado",
      "conectado",
      {
        timeout: 15000,
      },
    );

    // Contraste de los cuatro colores de la comanda (WCAG 2.1 AA).
    await expect(ticket).toHaveAttribute("data-nivel-espera", "a-tiempo");
    expect(await erroresGravesAxe(kdsPageMozo)).toEqual([]);

    await kdsPageMozo.clock.fastForward("31:00");
    await expect(ticket).toHaveAttribute("data-nivel-espera", "atencion");
    expect(await erroresGravesAxe(kdsPageMozo)).toEqual([]);

    await kdsPageMozo.clock.fastForward("30:00");
    await expect(ticket).toHaveAttribute("data-nivel-espera", "demorado");
    expect(await erroresGravesAxe(kdsPageMozo)).toEqual([]);

    await kdsPageMozo.clock.fastForward("01:00:00");
    await expect(ticket).toHaveAttribute("data-nivel-espera", "demora-alta");
    expect(await erroresGravesAxe(kdsPageMozo)).toEqual([]);

    // Y el indicador sin conexión.
    try {
      await context.setOffline(true);
      await expect(indicador(kdsPageMozo)).toHaveAttribute(
        "data-estado",
        "desconectado",
        {
          timeout: 5000,
        },
      );
      expect(await erroresGravesAxe(kdsPageMozo)).toEqual([]);
    } finally {
      await context.setOffline(false);
    }
  });
});
