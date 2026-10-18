import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { test, expect } from "../support/auth";
import { RESTAURANTE_ID } from "../support/ids";

// E2E de BL-357 (HU-013): gestión de usuarios en /admin/usuarios.
//
// Se usa la pestaña ya logueada del fixture kdsPageAdmin (support/auth.ts) y
// se navega a /admin/usuarios.
//
// ⚠️ Staging es compartido: cada test que cambia datos crea su propio usuario
// por la API y lo elimina en un `finally` (DELETE /usuarios/:id/permanente,
// BL-382: un usuario recién creado no tiene historial). Nunca se tocan los
// usuarios del seed. El test de la fila propia y el de axe solo abren y
// cierran diálogos, sin confirmar nada.

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const USUARIOS_PATH = "/admin/usuarios";

interface UsuarioListado {
  id: string;
  keycloakId: string;
  username?: string;
  activo: boolean;
  tieneHistorial?: boolean;
  cuentaCompartida?: boolean;
}

interface UsuarioDePrueba {
  id: string;
  username: string;
  /** Lo que muestra la fila: «Nombre Apellido». */
  nombre: string;
}

/**
 * Letras al azar para el apellido: el nombre solo acepta letras (BL-361),
 * así que no puede llevar el Date.now() que sí lleva el usuario.
 */
function letras(cantidad = 6): string {
  const abc = "abcdefghijklmnopqrstuvwxyz";
  let texto = "";
  for (let i = 0; i < cantidad; i++) {
    texto += abc[Math.floor(Math.random() * abc.length)];
  }
  return texto;
}

/**
 * Abre /admin/usuarios y espera el listado. Devuelve el Bearer que mandó el
 * frontend (para preparar y limpiar datos por API) y la respuesta de
 * GET /usuarios.
 */
async function abrirUsuarios(page: Page) {
  const [respuesta] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith("/usuarios") &&
        r.request().method() === "GET",
    ),
    page.goto(USUARIOS_PATH),
  ]);
  expect(respuesta.status()).toBe(200);
  await expect(page.getByRole("list", { name: "Usuarios" })).toBeVisible();
  return {
    authorization: respuesta.request().headers()["authorization"],
    usuarios: (await respuesta.json()) as UsuarioListado[],
  };
}

/** Alta de un Mozo de prueba por la API, como desde «Nuevo usuario». */
async function crearUsuario(
  request: APIRequestContext,
  authorization: string,
  etiqueta: string,
): Promise<UsuarioDePrueba> {
  const username = `e2e-${etiqueta}-${Date.now()}`;
  const apellido = `Prueba ${letras()}`;
  const res = await request.post(`${API_URL}/usuarios`, {
    headers: { authorization },
    data: {
      username,
      email: `${username}@bistrolink.dev`,
      nombre: "Etoe",
      apellido,
      rol: "MOZO",
      restauranteId: RESTAURANTE_ID,
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { id: string };
  return { id: body.id, username, nombre: `Etoe ${apellido}` };
}

/**
 * Limpieza: elimina el usuario de prueba. Si por algo quedó con historial,
 * al menos lo desactiva. No lanza: no tiene que tapar el error del test.
 */
async function eliminarUsuario(
  request: APIRequestContext,
  authorization: string,
  usuario: UsuarioDePrueba | undefined,
) {
  if (!usuario) return;
  const res = await request.delete(
    `${API_URL}/usuarios/${usuario.id}/permanente`,
    { headers: { authorization } },
  );
  if (!res.ok() && res.status() !== 404) {
    await request.delete(`${API_URL}/usuarios/${usuario.id}`, {
      headers: { authorization },
    });
  }
}

/** La fila de un usuario en el listado. */
function fila(page: Page, texto: string): Locator {
  return page
    .getByRole("list", { name: "Usuarios" })
    .getByRole("listitem")
    .filter({ hasText: texto });
}

/** Escribe en «Buscar» y elige el estado (los filtros son del navegador). */
async function filtrar(
  page: Page,
  busqueda: string,
  estado: "Activos" | "Inactivos" | "Todos" = "Activos",
) {
  await page
    .getByLabel("Estado", { exact: true })
    .selectOption({ label: estado });
  await page.getByLabel("Buscar", { exact: true }).fill(busqueda);
}

test.describe("BL-357 · Gestión de usuarios", () => {
  test("[TC-E-031] Usuarios: un usuario desactivado se reactiva desde su fila", async ({
    kdsPageAdmin: page,
  }) => {
    const { authorization } = await abrirUsuarios(page);
    let usuario: UsuarioDePrueba | undefined;
    try {
      usuario = await crearUsuario(page.request, authorization, "reactivar");
      const baja = await page.request.delete(
        `${API_URL}/usuarios/${usuario.id}`,
        { headers: { authorization } },
      );
      expect(baja.status()).toBe(200);

      await abrirUsuarios(page);
      await filtrar(page, usuario.username, "Inactivos");
      await expect(fila(page, usuario.username)).toContainText("Desactivado");

      await page
        .getByRole("button", { name: `Reactivar a ${usuario.nombre}` })
        .click();
      const dialogo = page.getByRole("dialog", { name: "Reactivar usuario" });
      await dialogo
        .getByRole("button", { name: "Reactivar", exact: true })
        .click();
      await expect(dialogo).toBeHidden();

      await filtrar(page, usuario.username, "Activos");
      await expect(fila(page, usuario.username)).toContainText("Activo");
    } finally {
      await eliminarUsuario(page.request, authorization, usuario);
    }
  });

  test("[TC-E-032] Usuarios: restablecer la contraseña muestra una temporal nueva", async ({
    kdsPageAdmin: page,
  }) => {
    const { authorization } = await abrirUsuarios(page);
    let usuario: UsuarioDePrueba | undefined;
    try {
      usuario = await crearUsuario(page.request, authorization, "restablecer");
      await abrirUsuarios(page);
      await filtrar(page, usuario.username);

      await page
        .getByRole("button", {
          name: `Restablecer la contraseña de ${usuario.nombre}`,
        })
        .click();
      const dialogo = page.getByRole("dialog", {
        name: "Restablecer contraseña",
      });
      await dialogo
        .getByRole("button", { name: "Restablecer", exact: true })
        .click();

      // La temporal se muestra una sola vez y el foco va a «Copiar».
      const temporal = dialogo.locator("code");
      await expect(temporal).toHaveText(/\S{8,}/);
      await expect(
        dialogo.getByRole("button", { name: "Copiar" }),
      ).toBeFocused();
      await dialogo.getByRole("button", { name: "Listo" }).click();
      await expect(dialogo).toBeHidden();
    } finally {
      await eliminarUsuario(page.request, authorization, usuario);
    }
  });

  test("[TC-E-033] Usuarios: buscar y filtrar por rol (incluida Cocina) y por estado", async ({
    kdsPageAdmin: page,
  }) => {
    const { authorization } = await abrirUsuarios(page);
    let usuario: UsuarioDePrueba | undefined;
    try {
      usuario = await crearUsuario(page.request, authorization, "filtrar");
      await abrirUsuarios(page);
      const lista = page.getByRole("list", { name: "Usuarios" });

      // Búsqueda por usuario: un solo resultado, y la cantidad se anuncia.
      await filtrar(page, usuario.username);
      await expect(lista.getByRole("listitem")).toHaveCount(1);
      await expect(page.getByText("1 usuario", { exact: true })).toBeVisible();

      // Por rol: con «Cocina», todas las filas son de la cuenta de cocina.
      await page.getByLabel("Buscar", { exact: true }).fill("");
      await page
        .getByLabel("Rol", { exact: true })
        .selectOption({ label: "Cocina" });
      const filasCocina = lista.getByRole("listitem");
      const cantidad = await filasCocina.count();
      for (let i = 0; i < cantidad; i++) {
        await expect(filasCocina.nth(i)).toContainText("Cuenta compartida");
      }
      await page
        .getByLabel("Rol", { exact: true })
        .selectOption({ label: "Todos" });

      // Por estado: desactivado, sale de «Activos» y aparece en «Inactivos».
      const baja = await page.request.delete(
        `${API_URL}/usuarios/${usuario.id}`,
        { headers: { authorization } },
      );
      expect(baja.status()).toBe(200);
      await abrirUsuarios(page);
      await filtrar(page, usuario.username, "Activos");
      await expect(
        page.getByText("No hay usuarios con esos filtros"),
      ).toBeVisible();
      await filtrar(page, usuario.username, "Inactivos");
      await expect(fila(page, usuario.username)).toBeVisible();
    } finally {
      await eliminarUsuario(page.request, authorization, usuario);
    }
  });

  test("[TC-E-034] Usuarios: editar nombre, apellido y correo", async ({
    kdsPageAdmin: page,
  }) => {
    const { authorization } = await abrirUsuarios(page);
    let usuario: UsuarioDePrueba | undefined;
    try {
      usuario = await crearUsuario(page.request, authorization, "editar");
      await abrirUsuarios(page);
      await filtrar(page, usuario.username);

      await page
        .getByRole("button", { name: `Editar a ${usuario.nombre}` })
        .click();
      const dialogo = page.getByRole("dialog", {
        name: `Editar a ${usuario.nombre}`,
      });
      const apellidoNuevo = `Editado ${letras()}`;
      const correoNuevo = `${usuario.username}-nuevo@bistrolink.dev`;
      await dialogo.getByLabel("Nombre", { exact: true }).fill("Etoedos");
      await dialogo.getByLabel("Apellido", { exact: true }).fill(apellidoNuevo);
      await dialogo.getByLabel("Correo", { exact: true }).fill(correoNuevo);
      await dialogo.getByRole("button", { name: "Guardar cambios" }).click();
      await expect(dialogo).toBeHidden();

      const filaEditada = fila(page, usuario.username);
      await expect(filaEditada).toContainText(`Etoedos ${apellidoNuevo}`);
      await expect(filaEditada).toContainText(correoNuevo);
    } finally {
      await eliminarUsuario(page.request, authorization, usuario);
    }
  });

  test("[TC-E-035] Usuarios: cerrar las sesiones de un usuario lo deja activo", async ({
    kdsPageAdmin: page,
  }) => {
    const { authorization } = await abrirUsuarios(page);
    let usuario: UsuarioDePrueba | undefined;
    try {
      usuario = await crearUsuario(page.request, authorization, "sesiones");
      await abrirUsuarios(page);
      await filtrar(page, usuario.username);

      await page
        .getByRole("button", {
          name: `Cerrar las sesiones de ${usuario.nombre}`,
        })
        .click();
      const dialogo = page.getByRole("dialog", { name: "Cerrar sesiones" });
      await dialogo.getByRole("button", { name: "Cerrar sesiones" }).click();

      // El resultado se anuncia en un <output> (rol status) y el foco pasa
      // a «Entendido».
      await expect(dialogo.getByRole("status")).toContainText(
        "se cerraron las sesiones",
      );
      await expect(
        dialogo.getByRole("button", { name: "Entendido" }),
      ).toBeFocused();
      await dialogo.getByRole("button", { name: "Entendido" }).click();

      await expect(fila(page, usuario.username)).toContainText("Activo");
    } finally {
      await eliminarUsuario(page.request, authorization, usuario);
    }
  });

  test("[TC-E-036] Usuarios: la fila propia no permite desactivarse, cerrar sus sesiones ni cambiarse el rol", async ({
    kdsPageAdmin: page,
  }) => {
    await abrirUsuarios(page);
    const propia = page
      .getByRole("list", { name: "Usuarios" })
      .getByRole("listitem")
      .filter({ hasText: "(vos)" });
    await expect(propia).toHaveCount(1);

    // Las acciones siguen con foco (para que el motivo se escuche), pero
    // están marcadas como no disponibles y el clic no abre nada.
    const desactivar = propia.getByRole("button", {
      name: /No podés desactivar tu propio usuario/,
    });
    await expect(desactivar).toHaveAttribute("aria-disabled", "true");
    await desactivar.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      propia.getByRole("button", {
        name: /No podés cerrar tus propias sesiones/,
      }),
    ).toHaveAttribute("aria-disabled", "true");
    // Tampoco se ofrece eliminarse.
    await expect(
      propia.getByRole("button", { name: /^Eliminar a/ }),
    ).toHaveCount(0);

    // En «Editar», el rol propio no se puede cambiar (los datos sí).
    await propia.getByRole("button", { name: /^Editar a/ }).click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo.getByLabel("Rol", { exact: true })).toBeDisabled();
    await expect(
      dialogo.getByText("No podés cambiar tu propio rol"),
    ).toBeVisible();
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialogo).toBeHidden();
  });

  test("[TC-E-037] Usuarios: se elimina un usuario sin historial; uno con historial no ofrece «Eliminar»", async ({
    kdsPageAdmin: page,
  }) => {
    const { authorization, usuarios } = await abrirUsuarios(page);
    let usuario: UsuarioDePrueba | undefined;
    try {
      usuario = await crearUsuario(page.request, authorization, "eliminar");
      await abrirUsuarios(page);
      await filtrar(page, usuario.username);

      await page
        .getByRole("button", { name: `Eliminar a ${usuario.nombre}` })
        .click();
      const dialogo = page.getByRole("dialog", { name: "Eliminar usuario" });
      // No se puede deshacer: el foco arranca en «Cancelar».
      await expect(
        dialogo.getByRole("button", { name: "Cancelar" }),
      ).toBeFocused();
      await dialogo
        .getByRole("button", { name: "Eliminar", exact: true })
        .click();
      await expect(dialogo).toBeHidden();

      await filtrar(page, usuario.username, "Todos");
      await expect(
        page.getByText("No hay usuarios con esos filtros"),
      ).toBeVisible();
      usuario = undefined; // ya no hay nada que limpiar
    } finally {
      await eliminarUsuario(page.request, authorization, usuario);
    }

    // Un usuario con historial (por ejemplo, el mozo que entrega pedidos en
    // otros E2E) solo se puede desactivar.
    const conHistorial = usuarios.find(
      (u) => u.tieneHistorial === true && u.username,
    );
    if (!conHistorial?.username) {
      // La primera parte ya pasó: se deja constancia en el reporte en vez de
      // marcar todo el test como salteado.
      test.info().annotations.push({
        type: "sin-datos",
        description:
          "No hay usuarios con historial en este entorno: no se comprobó la segunda parte.",
      });
      return;
    }
    await filtrar(page, conHistorial.username, "Todos");
    const filaConHistorial = fila(page, conHistorial.username);
    await expect(filaConHistorial).toBeVisible();
    await expect(
      filaConHistorial.getByRole("button", { name: /^Eliminar a/ }),
    ).toHaveCount(0);
  });

  test("[TC-E-038] Usuarios: la vista y sus diálogos no tienen errores graves de accesibilidad (axe-core)", async ({
    kdsPageAdmin: page,
  }) => {
    await abrirUsuarios(page);

    // Mismo alcance que TC-E-005 y TC-E-022 (decisión de equipo del
    // 2026-09-26): WCAG 2.1 AA; solo bloquean las violaciones critical o
    // serious.
    const revisar = async (incluir: string) => {
      const resultados = await new AxeBuilder({ page })
        .include(incluir)
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      return resultados.violations
        .filter((v) => v.impact === "critical" || v.impact === "serious")
        .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target) }));
    };

    expect(await revisar("main"), "vista de usuarios").toEqual([]);

    // Los diálogos se abren y se cierran sin confirmar: no cambian datos.
    const abrirYRevisar = async (boton: Locator, nombre: string) => {
      await boton.click();
      const dialogo = page.getByRole("dialog");
      await expect(dialogo).toBeVisible();
      expect(await revisar('[role="dialog"]'), nombre).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dialogo).toBeHidden();
    };

    await abrirYRevisar(
      page.getByRole("button", { name: "Nuevo usuario" }),
      "diálogo Nuevo usuario",
    );

    // Las acciones de otra persona activa (no la fila propia ni la cocina).
    const otra = page
      .getByRole("list", { name: "Usuarios" })
      .getByRole("listitem")
      .filter({ hasNotText: "(vos)" })
      .filter({ hasNotText: "Cuenta compartida" })
      .filter({ hasText: "Activo" })
      .first();
    await abrirYRevisar(
      otra.getByRole("button", { name: /^Editar a/ }),
      "diálogo Editar",
    );
    await abrirYRevisar(
      otra.getByRole("button", { name: /^Restablecer la contraseña de/ }),
      "diálogo Restablecer contraseña",
    );
    await abrirYRevisar(
      otra.getByRole("button", { name: /^Cerrar las sesiones de/ }),
      "diálogo Cerrar sesiones",
    );
    await abrirYRevisar(
      otra.getByRole("button", { name: /^Desactivar a/ }),
      "diálogo Desactivar",
    );
  });
});
