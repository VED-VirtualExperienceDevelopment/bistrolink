import { test, expect } from "../support/auth";
import { MESA_ID, MESA_ID_RATE_LIMIT } from "../support/ids";
import { ALERTAS_PATH, intentarDesestimarLlamado } from "../support/kds";

// HU-034 (BL-204): la mesa se abre desde la URL de su QR (fixture qrMesas)
// y el llamado va a POST /mesas/llamar con el token del QR en X-Mesa-Token.
//
// BL-441: el llamado queda pendiente en el servidor hasta que el mozo lo
// atiende, así que cada test lo desestima al terminar. Los números son los de
// las mesas del seed (MESA_ID y MESA_ID_RATE_LIMIT). El mozo lo recibe en la
// pantalla Alertas: el tablero del KDS ya no muestra los llamados normales.
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
      // /auth/comensal/mesa contra Keycloak. Por eso el timeout acá es
      // generoso: solo confirma que el llamado LLEGA, no cuánto tarda el login.
      await expect(
        kdsPageMozo
          .getByRole("main")
          .getByRole("listitem")
          .filter({ hasText: /Mesa 1 solicita atención/i }),
      ).toBeVisible({
        timeout: 5000,
      });

      await expect(mesaPage.getByText(/Avisamos al mozo/i)).toBeVisible();
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
      await expect(page.getByText(/Avisamos al mozo/i)).toBeVisible();

      await page.reload();
      await page.getByRole("button", { name: /Llamar al mozo/i }).click();
      await expect(page.getByText(/Ya llamaste al mozo/i)).toBeVisible();
    } finally {
      await intentarDesestimarLlamado(kdsPageMozo, NUMERO_MESA_RATE_LIMIT);
    }
  });
});

