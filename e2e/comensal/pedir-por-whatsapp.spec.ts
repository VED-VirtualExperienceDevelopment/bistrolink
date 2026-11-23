import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../support/auth";
import {
  ITEM_DISPONIBLE,
  MENU_URL_PATH,
  MESA_ID,
  RESTAURANTE_ID,
  TENANT_ID,
} from "../support/ids";

// HU-010 (BL-613): «¿Preferís pedir por WhatsApp?» en el menú para retirar.
//
// Cambia la configuración del establecimiento del seed (el número del bot),
// así que corre en el proyecto `chromium-configuracion` (playwright.config).
// Si el local ya tiene un número (por ejemplo, el del chip de la demo en
// staging), no lo toca: prueba con ese. Si no tiene, carga uno de prueba y
// lo quita al terminar. El chat nunca se abre: solo se mira el enlace.

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const CONFIGURACION_PATH = "/admin/configuracion";
const NUMERO_DE_PRUEBA = "099 123 456";
const NUMERO_DE_PRUEBA_GUARDADO = "+59899123456";

interface ConfiguracionWhatsapp {
  whatsappPedidos?: string | null;
  whatsappBotConectado?: boolean;
}

interface MenuDelLocal {
  whatsapp?: string | null;
  retiro?: { abierto: boolean };
}

const esConfiguracion = (url: string, metodo: string, buscado: string) =>
  new URL(url).pathname.endsWith(CONFIGURACION_PATH) && metodo === buscado;

test.describe("HU-010 (BL-613): pedir por WhatsApp desde el menú para retirar", () => {
  test("[TC-E-131] HU-010: el administrador carga el número del bot y el menú para retirar ofrece «¿Preferís pedir por WhatsApp?» si el bot atiende al local; el menú de la mesa nunca lo ofrece", async ({
    kdsPageAdmin: admin,
    page,
    qrMesas,
  }) => {
    // 1. Configuración: el campo, con el estado del bot.
    const [respuesta] = await Promise.all([
      admin.waitForResponse(
        (r) =>
          esConfiguracion(r.url(), r.request().method(), "GET") &&
          Boolean(r.request().headers()["authorization"]),
      ),
      admin.goto(CONFIGURACION_PATH),
    ]);
    expect(respuesta.status()).toBe(200);
    const authorization = respuesta.request().headers()["authorization"];
    const original = (await respuesta.json()) as ConfiguracionWhatsapp;
    expect(original).toHaveProperty("whatsappPedidos");

    const campo = admin.getByLabel("WhatsApp del bot (opcional)");
    await expect(campo).toBeVisible();
    await expect(
      admin.getByText(
        original.whatsappBotConectado
          ? "El bot de WhatsApp está conectado para este local."
          : /todavía no está conectado para este local/,
      ),
    ).toBeVisible();

    let quitarAlTerminar = false;
    try {
      let numero = original.whatsappPedidos ?? null;
      if (!numero) {
        await campo.fill(NUMERO_DE_PRUEBA);
        const [guardado] = await Promise.all([
          admin.waitForResponse((r) =>
            esConfiguracion(r.url(), r.request().method(), "PATCH"),
          ),
          admin.getByRole("button", { name: "Guardar cambios" }).click(),
        ]);
        expect(guardado.status()).toBe(200);
        quitarAlTerminar = true;
        // Se guarda en formato internacional.
        expect(
          ((await guardado.json()) as ConfiguracionWhatsapp).whatsappPedidos,
        ).toBe(NUMERO_DE_PRUEBA_GUARDADO);
        numero = NUMERO_DE_PRUEBA_GUARDADO;
      }

      // 2. La API del menú para retirar lo manda solo si el bot atiende al local.
      const api = await page.request.get(
        `${API_URL}/menu/tenant/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`,
      );
      expect(api.status()).toBe(200);
      const menu = (await api.json()) as MenuDelLocal;
      const digitos = numero.replace(/^\+/, "");
      expect(menu.whatsapp).toBe(
        original.whatsappBotConectado ? digitos : null,
      );

      // 3. El menú para retirar: el enlace en la portada, si corresponde.
      await page.goto(MENU_URL_PATH);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const enlace = page.getByRole("link", {
        name: /¿Preferís pedir por WhatsApp\?/,
      });
      if (menu.whatsapp && (menu.retiro?.abierto ?? true)) {
        await expect(enlace).toBeVisible();
        await expect(enlace).toHaveAttribute(
          "href",
          `https://wa.me/${digitos}?text=Hola`,
        );
        await expect(enlace).toHaveAttribute("target", "_blank");
        await expect(enlace).toHaveAttribute("rel", "noopener noreferrer");

        const resultados = await new AxeBuilder({ page })
          .include("main")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(
          resultados.violations
            .filter((v) => v.impact === "critical" || v.impact === "serious")
            .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
        ).toEqual([]);
      } else {
        await expect(enlace).toHaveCount(0);
      }

      // 4. El menú de la mesa nunca lo ofrece (el bot no toma pedidos de mesa).
      await page.goto(qrMesas.ruta(MESA_ID));
      await expect(page.getByText(ITEM_DISPONIBLE).first()).toBeVisible();
      await expect(
        page.getByRole("link", { name: /¿Preferís pedir por WhatsApp\?/ }),
      ).toHaveCount(0);
    } finally {
      if (quitarAlTerminar) {
        const res = await admin.request.patch(
          `${API_URL}${CONFIGURACION_PATH}`,
          { headers: { authorization }, data: { whatsappPedidos: null } },
        );
        expect(res.status(), await res.text()).toBe(200);
      }
    }
  });
});
