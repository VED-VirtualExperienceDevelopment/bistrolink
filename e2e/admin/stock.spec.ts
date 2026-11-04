import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "../support/auth";
import { tokenAdminDesdePanel } from "../support/qr-mesas";

// HU-015 (BL-120): stock de la jornada (/admin/stock) y campana de alertas
// de stock en el header.
//
// ⚠️ Staging es compartido: cada test que cambia datos crea su propia
// categoría «E2E stock …» con un ítem por la API y la elimina en un
// `finally` (el ítem no tiene pedidos, así que se puede eliminar). Nunca se
// toca el stock de los ítems del seed, que usan otros E2E.
//
// La campana puede mostrar alertas de otros datos de staging: los tests
// buscan su propio ítem por nombre y no cuentan el total. El descuento al
// confirmarse el pago y la sobreventa se prueban en la integración
// (stock.e2e-spec.ts).

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const STOCK_PATH = "/admin/stock";
const CAMPANA = /^Notificaciones de stock/;

interface ItemDePrueba {
  categoriaId: string;
  itemId: string;
  nombre: string;
}

/** Crea por la API una categoría de prueba con un ítem. */
async function crearItem(
  request: APIRequestContext,
  authorization: string,
): Promise<ItemDePrueba> {
  const sufijo = Date.now();
  const categoria = await request.post(`${API_URL}/admin/menu/categoria`, {
    headers: { authorization },
    data: { nombre: `E2E stock ${sufijo}` },
  });
  expect(categoria.status()).toBe(201);
  const { id: categoriaId } = (await categoria.json()) as { id: string };

  const nombre = `Postre E2E ${sufijo}`;
  const item = await request.post(`${API_URL}/admin/menu/item`, {
    headers: { authorization },
    data: { categoriaId, nombre, precio: "100" },
  });
  expect(item.status()).toBe(201);
  const { id: itemId } = (await item.json()) as { id: string };
  return { categoriaId, itemId, nombre };
}

/** Deja el ítem de prueba con control de stock y las unidades dadas. */
async function fijarStock(
  request: APIRequestContext,
  authorization: string,
  itemId: string,
  stockActual: number,
) {
  const res = await request.patch(`${API_URL}${STOCK_PATH}`, {
    headers: { authorization },
    data: {
      items: [{ itemId, controlaStock: true, stockActual, umbralAlerta: 5 }],
    },
  });
  expect(res.status()).toBe(200);
}

/**
 * Limpieza: elimina el ítem y la categoría de prueba. No lanza: no tiene
 * que tapar el error del test.
 */
async function eliminarItem(
  request: APIRequestContext,
  authorization: string,
  prueba: ItemDePrueba | undefined,
) {
  if (!prueba) return;
  const headers = { authorization };
  await request
    .delete(`${API_URL}/admin/menu/item/${prueba.itemId}`, { headers })
    .catch(() => undefined);
  await request
    .delete(`${API_URL}/admin/menu/categoria/${prueba.categoriaId}`, {
      headers,
    })
    .catch(() => undefined);
}

/** Espera que la campana muestre el ítem de prueba (llega por el socket). */
async function abrirCampanaCon(page: Page, nombre: string) {
  const campana = page.getByRole("button", { name: CAMPANA });
  await expect(async () => {
    if ((await campana.getAttribute("aria-expanded")) === "true") {
      await campana.click();
    }
    await campana.click();
    await expect(
      page.getByRole("menuitem", { name: new RegExp(nombre) }),
    ).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  return campana;
}

test.describe("BL-120: stock de la jornada y alertas de stock bajo", () => {
  test("[TC-E-069] HU-015: el administrador abre Stock desde el menú, activa el control de un ítem con pocas unidades y la campana lo avisa; la pantalla no tiene errores graves de accesibilidad", async ({
    kdsPageAdmin: page,
  }) => {
    const authorization = await tokenAdminDesdePanel(page);
    let prueba: ItemDePrueba | undefined;
    try {
      prueba = await crearItem(page.request, authorization);
      const { nombre, itemId } = prueba;

      const [lista] = await Promise.all([
        page.waitForResponse(
          (res) =>
            new URL(res.url()).pathname === STOCK_PATH &&
            res.request().method() === "GET",
        ),
        page.getByRole("link", { name: "Stock", exact: true }).first().click(),
      ]);
      expect(lista.status()).toBe(200);
      await expect(page).toHaveURL(new RegExp(`${STOCK_PATH}$`));
      await expect(
        page.getByRole("heading", { name: "Stock de la jornada", level: 1 }),
      ).toBeVisible();

      // Sin control de stock, los campos están deshabilitados.
      const unidades = page.getByRole("textbox", {
        name: `Unidades de ${nombre}`,
      });
      const aviso = page.getByRole("textbox", {
        name: `Avisar cuando queden: ${nombre}`,
      });
      await expect(unidades).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Guardar" }),
      ).toBeDisabled();

      await page
        .getByRole("switch", { name: `Controlar stock de ${nombre}` })
        .click();
      await unidades.fill("2");
      // El aviso por defecto es 5: se cambia a 3 para que viaje en el PATCH.
      await aviso.fill("3");
      await expect(
        page.getByText("Hay 1 ítem con cambios sin guardar."),
      ).toBeVisible();

      const [guardado] = await Promise.all([
        page.waitForResponse(
          (res) =>
            new URL(res.url()).pathname === STOCK_PATH &&
            res.request().method() === "PATCH",
        ),
        page.getByRole("button", { name: "Guardar" }).click(),
      ]);
      expect(guardado.status()).toBe(200);
      // Solo se manda lo que cambió del ítem de prueba.
      expect(guardado.request().postDataJSON()).toEqual({
        items: [
          { itemId, controlaStock: true, stockActual: 2, umbralAlerta: 3 },
        ],
      });
      await expect(page.getByText("Se guardó 1 ítem.")).toBeAttached();
      await expect(
        page.getByRole("row", { name: new RegExp(nombre) }),
      ).toContainText("Por agotarse");

      await abrirCampanaCon(page, nombre);
      await expect(
        page.getByRole("menuitem", { name: new RegExp(nombre) }),
      ).toContainText("Quedan 2 · aviso en 3");
      await page.keyboard.press("Escape");

      const resultados = await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        resultados.violations
          .filter((v) => v.impact === "critical" || v.impact === "serious")
          .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
    } finally {
      await eliminarItem(page.request, authorization, prueba);
    }
  });

  test("[TC-E-070] HU-015: la campana se usa con el teclado y «Reponer stock» valida las unidades y saca el ítem de las alertas", async ({
    kdsPageAdmin: page,
  }) => {
    const authorization = await tokenAdminDesdePanel(page);
    let prueba: ItemDePrueba | undefined;
    try {
      prueba = await crearItem(page.request, authorization);
      const { nombre, itemId } = prueba;
      await fijarStock(page.request, authorization, itemId, 0);
      await page.goto("/admin/mesas");

      const campana = await abrirCampanaCon(page, nombre);
      await expect(
        page.getByRole("menuitem", { name: new RegExp(nombre) }),
      ).toContainText("Agotado");
      await page.keyboard.press("Escape");
      await expect(campana).toHaveAttribute("aria-expanded", "false");
      await expect(campana).toBeFocused();

      // Con el teclado: Enter abre y el foco va a la primera alerta; Fin
      // lleva al enlace de la pantalla de stock; Inicio vuelve al principio.
      await page.keyboard.press("Enter");
      await expect(campana).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("menuitem").first()).toBeFocused();
      await page.keyboard.press("End");
      await expect(
        page.getByRole("menuitem", { name: "Ver el stock de la jornada" }),
      ).toBeFocused();
      await page.keyboard.press("Home");
      await expect(page.getByRole("menuitem").first()).toBeFocused();

      // Reponer desde la campana.
      await page.getByRole("menuitem", { name: new RegExp(nombre) }).click();
      const dialogo = page.getByRole("dialog", {
        name: `Reponer stock: ${nombre}`,
      });
      await expect(dialogo).toBeVisible();
      const campo = dialogo.getByLabel("Unidades disponibles ahora");
      await expect(campo).toBeFocused();

      await campo.fill("2,5");
      await dialogo.getByRole("button", { name: "Guardar" }).click();
      await expect(
        dialogo.getByText("Usá un número entero, sin decimales."),
      ).toBeVisible();
      await expect(campo).toHaveAttribute("aria-invalid", "true");

      await campo.fill("20");
      const [repuesto] = await Promise.all([
        page.waitForResponse(
          (res) =>
            new URL(res.url()).pathname === STOCK_PATH &&
            res.request().method() === "PATCH",
        ),
        dialogo.getByRole("button", { name: "Guardar" }).click(),
      ]);
      expect(repuesto.status()).toBe(200);
      await expect(dialogo).toBeHidden();
      await expect(campana).toBeFocused();

      // Con 20 unidades y aviso en 5, ya no está en las alertas.
      await campana.click();
      await expect(
        page.getByRole("menuitem", { name: new RegExp(nombre) }),
      ).toHaveCount(0);
    } finally {
      await eliminarItem(page.request, authorization, prueba);
    }
  });

  test("[TC-E-071] HU-015: el mozo no ve la campana de stock ni Stock en el menú, y si entra a la ruta vuelve al mapa de mesas", async ({
    kdsPageMozo: page,
  }) => {
    await page.goto("/admin/mesas");
    await expect(
      page.getByRole("link", { name: "Mapa de mesas" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: CAMPANA })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Stock", exact: true }),
    ).toHaveCount(0);

    await page.goto(STOCK_PATH);
    await expect(page).toHaveURL(/\/admin\/mesas$/);
  });
});
