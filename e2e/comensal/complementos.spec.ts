import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page, Route } from "@playwright/test";
import { test, expect } from "../support/auth";
import {
  ITEM_DISPONIBLE,
  MENU_URL_PATH,
  RESTAURANTE_ID,
  TENANT_ID,
} from "../support/ids";

// HU-046 (BL-553 y BL-555): sugerencia de complementos en el detalle del
// pedido, una vez por pedido.
//
// Qué plato se sugiere depende de las ventas reales del local (reglas de
// asociación o, sin reglas, el más pedido), y en un staging recién cargado
// puede no haber ninguno. Por eso:
// - se prueba el contrato del endpoint real (200 y la forma de la
//   respuesta), y
// - para la pantalla, la respuesta del endpoint se fija con page.route: un
//   plato real de la carta, así «Agregar» lo suma de verdad.
// La lógica de las reglas la prueban TC-I-227 a 229.

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const CELULAR = { width: 360, height: 800 };
const ESCRITORIO = { width: 1280, height: 800 };
const TITULO = "¿Querés sumar algo?";

interface PlatoDeLaCarta {
  id: string;
  nombre: string;
  precio: string;
  disponible: boolean;
}

/** Un plato disponible de la carta, distinto del que se agrega primero. */
async function platosDeLaCarta(request: APIRequestContext) {
  const res = await request.get(
    `${API_URL}/menu/tenant/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`,
  );
  expect(res.status()).toBe(200);
  const { categorias } = (await res.json()) as {
    categorias: { items: PlatoDeLaCarta[] }[];
  };
  const platos = categorias.flatMap((c) => c.items);
  const principal = platos.find((p) => p.nombre === ITEM_DISPONIBLE);
  const sugerido = platos.find(
    (p) => p.disponible && p.nombre !== ITEM_DISPONIBLE,
  );
  expect(principal, "falta el plato del seed").toBeDefined();
  expect(sugerido, "la carta necesita otro plato disponible").toBeDefined();
  return {
    principal: principal as PlatoDeLaCarta,
    sugerido: sugerido as PlatoDeLaCarta,
  };
}

/**
 * Fija la respuesta del endpoint de complementos con `sugerido` y guarda los
 * cuerpos de los pedidos que hace la carta.
 */
async function fijarSugerencia(page: Page, sugerido: PlatoDeLaCarta) {
  const cuerpos: { itemsEnPedido: string[] }[] = [];
  await page.route("**/complementos", async (route: Route) => {
    cuerpos.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        origen: "reglas",
        sugerencias: [
          {
            id: sugerido.id,
            nombre: sugerido.nombre,
            descripcion: null,
            precio: sugerido.precio,
            imagenUrl: null,
          },
        ],
      }),
    });
  });
  return cuerpos;
}

async function sinErroresGraves(page: Page, selector: string) {
  const resultados = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    resultados.violations
      .filter((v) => v.impact === "critical" || v.impact === "serious")
      .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
}

async function agregarPrincipal(page: Page) {
  await page.goto(MENU_URL_PATH);
  await expect(page.getByText(ITEM_DISPONIBLE).first()).toBeVisible();
  await page
    .getByRole("button", {
      name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
    })
    .click();
}

test.describe("HU-046: sugerencia de complementos", () => {
  test.describe("en el celular", () => {
    test.use({ viewport: CELULAR });

    test("[TC-E-123] HU-046: en la hoja del pedido se ve la sugerencia, «Agregar» suma el plato y no vuelve a aparecer en ese pedido (sin errores graves de accesibilidad)", async ({
      page,
    }) => {
      const { principal, sugerido } = await platosDeLaCarta(page.request);

      // El endpoint real responde con la forma esperada.
      const real = await page.request.post(
        `${API_URL}/menu/tenant/${TENANT_ID}/restaurante/${RESTAURANTE_ID}/complementos`,
        { data: { itemsEnPedido: [principal.id] } },
      );
      expect(real.status()).toBe(200);
      const cuerpo = await real.json();
      expect(["reglas", "popularidad", "ninguno"]).toContain(cuerpo.origen);
      expect(Array.isArray(cuerpo.sugerencias)).toBe(true);
      expect(cuerpo.sugerencias.length).toBeLessThanOrEqual(2);

      const cuerpos = await fijarSugerencia(page, sugerido);
      await agregarPrincipal(page);
      await page.getByTestId("carrito-barra").click();
      const hoja = page.getByTestId("carrito-hoja");
      const bloque = hoja.getByRole("region", { name: TITULO });
      await expect(bloque).toBeVisible();
      await expect(
        bloque.getByText("Suele pedirse junto con lo que elegiste"),
      ).toBeVisible();
      // Se pidió con el plato del pedido.
      expect(cuerpos[0]?.itemsEnPedido).toEqual([principal.id]);

      const agregar = bloque.getByRole("button", {
        name: `Agregar ${sugerido.nombre} al pedido`,
      });
      const caja = await agregar.boundingBox();
      expect(caja?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(
        bloque.getByRole("button", { name: "No, gracias" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        "scroll horizontal en 360 px",
      ).toBe(false);
      await sinErroresGraves(page, '[data-testid="carrito-hoja"]');

      await agregar.click();
      await expect(hoja.getByText(`1x ${sugerido.nombre}`)).toBeVisible();
      await expect(bloque).toHaveCount(0);
      await expect(page.locator("output[aria-live]")).toContainText(
        `Agregaste ${sugerido.nombre}`,
      );

      // Cerrar y abrir la hoja: no vuelve a aparecer, ni se vuelve a pedir.
      await hoja.getByRole("button", { name: "Cerrar el pedido" }).click();
      await page.getByTestId("carrito-barra").click();
      await expect(hoja.getByText(`1x ${ITEM_DISPONIBLE}`)).toBeVisible();
      await expect(hoja.getByRole("region", { name: TITULO })).toHaveCount(0);
      expect(cuerpos).toHaveLength(1);
    });
  });

  test.describe("en escritorio", () => {
    test.use({ viewport: ESCRITORIO });

    test("[TC-E-124] HU-046: en la columna del pedido «No, gracias» saca la sugerencia sin cambiar el pedido (sin errores graves de accesibilidad)", async ({
      page,
    }) => {
      const { sugerido } = await platosDeLaCarta(page.request);
      await fijarSugerencia(page, sugerido);
      await agregarPrincipal(page);

      const columna = page.getByRole("complementary");
      const bloque = columna.getByRole("region", { name: TITULO });
      await expect(bloque).toBeVisible();
      await sinErroresGraves(page, "aside");

      await bloque.getByRole("button", { name: "No, gracias" }).click();
      await expect(bloque).toHaveCount(0);
      await expect(columna.getByText(`1x ${ITEM_DISPONIBLE}`)).toBeVisible();
      await expect(columna.getByText(`1x ${sugerido.nombre}`)).toHaveCount(0);
      // El foco pasa al título del pedido.
      await expect(
        columna.getByRole("heading", { name: /Tu pedido/ }),
      ).toBeFocused();
    });
  });
});
