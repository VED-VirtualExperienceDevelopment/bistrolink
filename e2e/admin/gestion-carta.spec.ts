import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, RESTAURANTE_ID } from "../support/ids";

// E2E de BL-402 (BL-392): Gestión de Carta en /admin/menu.
//
// Se usan las pestañas ya logueadas de los fixtures kdsPageAdmin y
// kdsPageMozo (support/auth.ts) y se navega a /admin/menu.
//
// ⚠️ Staging es compartido: cada test que cambia datos crea su propia
// categoría «E2E carta …» por la API y la elimina en un `finally`, con sus
// ítems (ninguno tiene pedidos, así que se pueden eliminar). Nunca se tocan
// las categorías ni los ítems del seed.
//
// En serie: TC-E-053 reordena las categorías, y la API rechaza el orden
// (409) si otra prueba agrega o borra una categoría al mismo tiempo.

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const CARTA_PATH = "/admin/menu";

const ANCHOS = [
  { nombre: "celular", width: 390, height: 844 },
  { nombre: "tablet", width: 768, height: 1024 },
  { nombre: "PC", width: 1280, height: 800 },
];

interface ItemDePrueba {
  id: string;
  nombre: string;
}

interface CategoriaDePrueba {
  id: string;
  nombre: string;
  items: ItemDePrueba[];
}

test.describe.configure({ mode: "serial" });

/**
 * Abre /admin/menu y espera la carta. Devuelve el Bearer que mandó el
 * frontend, para preparar y limpiar datos por la API.
 */
async function abrirCarta(page: Page): Promise<string> {
  const [respuesta] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith("/admin/menu/categoria") &&
        r.request().method() === "GET" &&
        r.request().resourceType() === "fetch" &&
        Boolean(r.request().headers()["authorization"]),
    ),
    page.goto(CARTA_PATH),
  ]);
  expect(respuesta.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Gestión de Carta" }),
  ).toBeVisible();
  return respuesta.request().headers()["authorization"];
}

/** Crea por la API una categoría de prueba con sus ítems, en ese orden. */
async function crearCategoria(
  request: APIRequestContext,
  authorization: string,
  nombresItems: string[],
): Promise<CategoriaDePrueba> {
  const nombre = `E2E carta ${Date.now()}`;
  const res = await request.post(`${API_URL}/admin/menu/categoria`, {
    headers: { authorization },
    data: { nombre },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };

  const items: ItemDePrueba[] = [];
  for (const nombreItem of nombresItems) {
    const alta = await request.post(`${API_URL}/admin/menu/item`, {
      headers: { authorization },
      data: { categoriaId: id, nombre: nombreItem, precio: "100" },
    });
    expect(alta.status()).toBe(201);
    items.push({
      id: ((await alta.json()) as { id: string }).id,
      nombre: nombreItem,
    });
  }
  return { id, nombre, items };
}

/**
 * Limpieza: elimina la categoría de prueba y todos sus ítems, también los
 * archivados y los que creó el test desde la pantalla. No lanza: no tiene
 * que tapar el error del test.
 */
async function eliminarCategoria(
  request: APIRequestContext,
  authorization: string,
  categoria: CategoriaDePrueba | undefined,
) {
  if (!categoria) return;
  const headers = { authorization };
  const res = await request.get(
    `${API_URL}/admin/menu/categoria?restauranteId=${RESTAURANTE_ID}&incluirArchivados=true`,
    { headers },
  );
  const categorias = res.ok()
    ? ((await res.json()) as { id: string; items: { id: string }[] }[])
    : [];
  const actual = categorias.find((c) => c.id === categoria.id);
  for (const item of actual?.items ?? []) {
    await request.delete(`${API_URL}/admin/menu/item/${item.id}`, { headers });
  }
  await request.delete(`${API_URL}/admin/menu/categoria/${categoria.id}`, {
    headers,
  });
}

/** La sección de una categoría (región con el nombre de su título). */
function seccion(page: Page, categoria: CategoriaDePrueba): Locator {
  return page.getByRole("region", { name: categoria.nombre });
}

/** La tarjeta de un ítem dentro de su categoría. */
function tarjeta(page: Page, categoria: CategoriaDePrueba, nombre: string) {
  return seccion(page, categoria)
    .getByRole("listitem")
    .filter({ hasText: nombre });
}

/**
 * Nombres de los ítems de una categoría, en el orden en que se ven. Salen
 * del switch de cada tarjeta («Flan disponible»), no del de la categoría:
 * el título del admin lleva además un «Editar» oculto para el lector de
 * pantalla.
 */
async function ordenDeItems(page: Page, categoria: CategoriaDePrueba) {
  const etiquetas = await seccion(page, categoria)
    .getByRole("listitem")
    .getByRole("switch")
    .evaluateAll((switches) =>
      switches.map((s) => s.getAttribute("aria-label") ?? ""),
    );
  return etiquetas.map((e) => e.replace(/ disponible$/, ""));
}

/** Nombres de las categorías, en el orden en que se ven. */
async function ordenDeCategorias(page: Page) {
  return page.locator("section[aria-labelledby] h2").allInnerTexts();
}

/** WCAG 2.1 AA; solo bloquean las violaciones critical o serious. */
async function violacionesGraves(page: Page) {
  const resultados = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return resultados.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target.join(" ")) }));
}

test.describe("BL-392 · Gestión de Carta", () => {
  test("[TC-E-050] Carta: el admin agrega un ítem con centésimos y se ve con el precio en pesos", async ({
    kdsPageAdmin: page,
  }) => {
    const authorization = await abrirCarta(page);
    let categoria: CategoriaDePrueba | undefined;
    try {
      categoria = await crearCategoria(page.request, authorization, []);
      await abrirCarta(page);

      await seccion(page, categoria)
        .getByRole("button", { name: "Agregar ítem" })
        .click();
      const dialogo = page.getByRole("dialog", { name: "Nuevo ítem" });
      await dialogo.getByLabel("Nombre", { exact: true }).fill("Chivito E2E");
      await dialogo.getByLabel("Precio", { exact: true }).fill("590,50");
      await dialogo.getByRole("button", { name: "Guardar" }).click();

      await expect(dialogo).toBeHidden();
      await expect(tarjeta(page, categoria, "Chivito E2E")).toContainText(
        "590,50",
      );
    } finally {
      await eliminarCategoria(page.request, authorization, categoria);
    }
  });

  test("[TC-E-051] Carta: archivar un ítem lo saca de la vista y «Deshacer» lo restaura", async ({
    kdsPageAdmin: page,
  }) => {
    const authorization = await abrirCarta(page);
    let categoria: CategoriaDePrueba | undefined;
    try {
      categoria = await crearCategoria(page.request, authorization, [
        "Flan E2E",
      ]);
      await abrirCarta(page);
      const flan = tarjeta(page, categoria, "Flan E2E");

      await flan.getByRole("button", { name: "Acciones de Flan E2E" }).click();
      await page.getByRole("menuitem", { name: "Archivar" }).click();
      const dialogo = page.getByRole("dialog", { name: "Archivar ítem" });
      // Mismo criterio que Usuarios: el foco arranca en «Cancelar».
      await expect(
        dialogo.getByRole("button", { name: "Cancelar" }),
      ).toBeFocused();
      await dialogo
        .getByRole("button", { name: "Archivar", exact: true })
        .click();

      await expect(dialogo).toBeHidden();
      await expect(flan).toHaveCount(0);
      await expect(page.getByText("Ítem «Flan E2E» archivado")).toBeVisible();

      await page.getByRole("button", { name: "Deshacer" }).click();
      await expect(flan).toHaveCount(1);
    } finally {
      await eliminarCategoria(page.request, authorization, categoria);
    }
  });

  test("[TC-E-052] Carta: marcar un ítem como agotado muestra el aviso y queda guardado", async ({
    kdsPageAdmin: page,
  }) => {
    const authorization = await abrirCarta(page);
    let categoria: CategoriaDePrueba | undefined;
    try {
      categoria = await crearCategoria(page.request, authorization, [
        "Pancho E2E",
      ]);
      await abrirCarta(page);
      const disponible = seccion(page, categoria).getByRole("switch", {
        name: "Pancho E2E disponible",
      });

      await disponible.click();
      await expect(disponible).toHaveAttribute("aria-checked", "false");
      await expect(
        tarjeta(page, categoria, "Pancho E2E").getByText("Agotado"),
      ).toBeVisible();

      // Al volver a abrir la carta sigue agotado: se guardó en la API.
      await abrirCarta(page);
      await expect(disponible).toHaveAttribute("aria-checked", "false");
    } finally {
      await eliminarCategoria(page.request, authorization, categoria);
    }
  });

  test("[TC-E-053] Carta: el orden se cambia con «Subir» y arrastrando con el teclado, y queda guardado", async ({
    kdsPageAdmin: page,
  }) => {
    // Dos guardados y tres aperturas de la carta: más margen que el de por
    // defecto, para que la limpieza del final llegue a correr.
    test.setTimeout(60_000);
    const authorization = await abrirCarta(page);
    let categoria: CategoriaDePrueba | undefined;
    try {
      categoria = await crearCategoria(page.request, authorization, [
        "Primero E2E",
        "Segundo E2E",
      ]);
      await abrirCarta(page);
      expect(await ordenDeItems(page, categoria)).toEqual([
        "Primero E2E",
        "Segundo E2E",
      ]);

      // Ítems: «Subir» desde el menú «⋯».
      await tarjeta(page, categoria, "Segundo E2E")
        .getByRole("button", { name: "Acciones de Segundo E2E" })
        .click();
      await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().endsWith(`/admin/menu/categoria/${categoria?.id}/orden`) &&
            r.request().method() === "PUT",
          { timeout: 10_000 },
        ),
        page.getByRole("menuitem", { name: "Subir" }).click(),
      ]);
      // El foco vuelve al «⋯» del ítem que se movió.
      await expect(
        page.getByRole("button", { name: "Acciones de Segundo E2E" }),
      ).toBeFocused();

      // Categorías: la nueva quedó última; con el teclado sube un lugar.
      // Antes de cada tecla se espera la señal de la pantalla (manija
      // levantada, aviso de la posición): dnd-kit empieza a escuchar las
      // flechas un instante después de levantar.
      const antes = await ordenDeCategorias(page);
      const total = antes.length;
      expect(antes.at(-1)).toBe(categoria.nombre);
      const manija = page.getByRole("button", {
        name: `Mover la categoría ${categoria.nombre}`,
      });
      const aviso = page
        .getByRole("status")
        .filter({ hasText: `«${categoria.nombre}»` });
      await manija.focus();
      await page.keyboard.press("Space");
      await expect(manija, "la manija no se levantó").toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await page.keyboard.press("ArrowUp");
      await expect(aviso, "la flecha arriba no la movió").toContainText(
        `sobre la posición ${total - 1} de ${total}`,
      );
      const guardado = page.waitForResponse(
        (r) =>
          r.url().endsWith("/admin/menu/categorias/orden") &&
          r.request().method() === "PUT",
        { timeout: 10_000 },
      );
      await page.keyboard.press("Space");
      await expect(manija, "la manija no se soltó").not.toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect((await guardado).status()).toBe(200);

      // Al volver a abrir la carta, los dos cambios siguen.
      await abrirCarta(page);
      expect(await ordenDeItems(page, categoria)).toEqual([
        "Segundo E2E",
        "Primero E2E",
      ]);
      const despues = await ordenDeCategorias(page);
      expect(despues.at(-2)).toBe(categoria.nombre);
      expect(despues.at(-1)).toBe(antes.at(-2));
    } finally {
      await eliminarCategoria(page.request, authorization, categoria);
    }
  });

  test("[TC-E-054] Carta: el mozo solo marca agotados; no ve acciones de edición ni para ordenar", async ({
    kdsPageMozo: page,
  }) => {
    await abrirCarta(page);

    await expect(
      page.getByRole("switch", { name: `${ITEM_DISPONIBLE} disponible` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Nueva categoría" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Acciones de/ }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Mover / })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Agregar ítem" }),
    ).toHaveCount(0);
    // Los filtros de lo oculto y lo archivado son solo del admin.
    const estados = await page
      .getByLabel("Estado", { exact: true })
      .locator("option")
      .allInnerTexts();
    expect(estados).not.toContain("Archivados");
    expect(estados).not.toContain("En categorías ocultas");
  });

  test("[TC-E-055] Carta: la vista, el menú «⋯» y los diálogos no tienen errores graves de accesibilidad en celular, tablet y PC (axe-core)", async ({
    kdsPageAdmin: page,
  }) => {
    const authorization = await abrirCarta(page);
    let categoria: CategoriaDePrueba | undefined;
    try {
      categoria = await crearCategoria(page.request, authorization, [
        "Milhojas E2E",
        "Torta E2E",
      ]);
      await abrirCarta(page);

      for (const ancho of ANCHOS) {
        await page.setViewportSize({
          width: ancho.width,
          height: ancho.height,
        });
        expect(
          await violacionesGraves(page),
          `carta (${ancho.nombre})`,
        ).toEqual([]);

        // Menú «⋯» abierto.
        const acciones = page.getByRole("button", {
          name: "Acciones de Milhojas E2E",
        });
        await acciones.click();
        await expect(page.getByRole("menu")).toBeVisible();
        expect(
          await violacionesGraves(page),
          `menú de acciones (${ancho.nombre})`,
        ).toEqual([]);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toBeHidden();

        // Los diálogos se abren y se cierran sin guardar nada.
        const abrirYRevisar = async (abrir: Locator, titulo: string) => {
          await abrir.click();
          const dialogo = page.getByRole("dialog", { name: titulo });
          await expect(dialogo).toBeVisible();
          expect(
            await violacionesGraves(page),
            `diálogo «${titulo}» (${ancho.nombre})`,
          ).toEqual([]);
          await dialogo.getByRole("button", { name: "Cancelar" }).click();
          await expect(dialogo).toBeHidden();
        };
        await abrirYRevisar(
          page.getByRole("button", { name: "Nueva categoría" }),
          "Nueva categoría",
        );
        await abrirYRevisar(
          seccion(page, categoria).getByRole("button", {
            name: "Agregar ítem",
          }),
          "Nuevo ítem",
        );
        await acciones.click();
        await abrirYRevisar(
          page.getByRole("menuitem", { name: "Archivar" }),
          "Archivar ítem",
        );

        // Con un filtro: el aviso «quitá los filtros» y el resultado.
        await page.getByLabel("Buscar", { exact: true }).fill("Milhojas E2E");
        await expect(
          page.getByText("Para cambiar el orden, quitá los filtros."),
        ).toBeVisible();
        expect(
          await violacionesGraves(page),
          `carta filtrada (${ancho.nombre})`,
        ).toEqual([]);
        await page.getByLabel("Buscar", { exact: true }).fill("");
      }
    } finally {
      await page.setViewportSize({ width: 1280, height: 800 });
      await eliminarCategoria(page.request, authorization, categoria);
    }
  });
});
