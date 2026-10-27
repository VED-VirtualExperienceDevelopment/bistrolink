import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  crearEstablecimiento,
  eliminarEstablecimiento,
  hayCredencialesPlataforma,
  ingresarPlataforma,
  type EstablecimientoDePrueba,
} from "../support/plataforma";

// E2E de BL-416 (BL-404): gestión de establecimientos en /plataforma con el
// usuario de plataforma de E2E (usuario, contraseña y OTP: ver
// support/plataforma.ts).
//
// ⚠️ Staging es compartido: el spec da de alta su PROPIO establecimiento por
// la API y nunca toca los demás. Los tests van en orden (modo serial) sobre
// ese establecimiento y el último lo elimina desde la ficha (BL-418);
// afterAll lo elimina por la API si algo falló antes. Un solo ingreso y una
// sola alta por corrida: la plataforma limita las altas a 10 por hora.
//
// Sin las variables TEST_PLATAFORMA_* el spec se saltea.

// Mismo alcance que el resto de los E2E (decisión de equipo del 2026-09-26):
// WCAG 2.1 AA; solo bloquean las violaciones critical o serious.
async function violacionesGraves(page: Page) {
  const resultados = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return resultados.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => ({ id: v.id, nodos: v.nodes.map((n) => n.target.join(" ")) }));
}

const ANCHOS = [
  { nombre: "celular", width: 390, height: 844 },
  { nombre: "tablet", width: 768, height: 1024 },
  { nombre: "PC", width: 1280, height: 800 },
];

test.describe.configure({ mode: "serial" });

test.describe("BL-404 · Gestión de establecimientos (plataforma)", () => {
  test.skip(
    !hayCredencialesPlataforma(),
    "Faltan las variables TEST_PLATAFORMA_* (ver e2e/README.md)",
  );

  let page: Page;
  let request: APIRequestContext;
  let authorization: string;
  let establecimiento: EstablecimientoDePrueba;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    });
    page = await context.newPage();
    request = context.request;
    authorization = await ingresarPlataforma(page);
    establecimiento = await crearEstablecimiento(request, authorization);
  });

  test.afterAll(async () => {
    if (establecimiento) {
      await eliminarEstablecimiento(request, authorization, establecimiento);
    }
    await page?.context().close();
  });

  const buscador = () => page.getByLabel("Buscar", { exact: true });
  const filtroEstado = () => page.getByLabel("Estado", { exact: true });
  const fila = () =>
    page
      .getByRole("list", { name: "Establecimientos" })
      .getByRole("listitem")
      .filter({ hasText: establecimiento.rut });

  // El estado vacío del listado. El mismo texto está también en la región
  // aria-live (sr-only) que anuncia el resultado: se toma solo el visible.
  const sinCoincidencias = () =>
    page
      .locator("p:not(.sr-only)")
      .filter({ hasText: /Ningún establecimiento coincide con/ });

  /** Abre el listado y busca el establecimiento de prueba por su RUT. */
  async function buscarEnListado(estado = "") {
    await page.goto("/plataforma");
    await filtroEstado().selectOption(estado);
    await buscador().fill(establecimiento.rut);
  }

  async function abrirFicha() {
    await buscarEnListado();
    const ver = `Ver ficha de ${establecimiento.razonSocial}`;
    await fila().getByRole("link", { name: ver }).click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: establecimiento.razonSocial,
      }),
    ).toBeVisible();
  }

  test("[TC-E-040] Plataforma: busca un establecimiento por RUT y por razón social, y lo filtra por estado", async () => {
    await buscarEnListado();
    await expect(fila()).toHaveCount(1);
    await expect(fila()).toContainText(establecimiento.razonSocial);

    // Por razón social, sin distinguir mayúsculas.
    await buscador().fill(establecimiento.razonSocial.toLowerCase());
    await expect(fila()).toHaveCount(1);

    // Está activo: aparece con «Activos» y no con «Suspendidos».
    await buscador().fill(establecimiento.rut);
    await filtroEstado().selectOption({ label: "Activos" });
    await expect(fila()).toHaveCount(1);
    await filtroEstado().selectOption({ label: "Suspendidos" });
    await expect(sinCoincidencias()).toBeVisible();
    await expect(fila()).toHaveCount(0);
  });

  test("[TC-E-041] Plataforma: la ficha muestra los datos, el Administrador y el resumen del establecimiento", async () => {
    await abrirFicha();

    await expect(page.getByText(`RUT ${establecimiento.rut}`)).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Administradores" }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Administradores" }).getByRole("listitem"),
    ).toHaveCount(1);
    await expect(
      page.getByRole("heading", { level: 2, name: "Resumen" }),
    ).toBeVisible();
    // Sin pedidos: se ofrece eliminarlo (BL-418).
    await expect(
      page.getByRole("button", { name: "Eliminar definitivamente" }),
    ).toBeVisible();
  });

  test("[TC-E-042] Plataforma: edita la razón social desde la ficha y el cambio se ve en la ficha y en el listado", async () => {
    await abrirFicha();
    const nueva = `${establecimiento.razonSocial} Editado`;

    await page.getByRole("button", { name: "Editar datos" }).click();
    const dialogo = page.getByRole("dialog", {
      name: `Editar ${establecimiento.razonSocial}`,
    });
    await dialogo.getByLabel("Razón social").fill(nueva);
    await dialogo.getByRole("button", { name: "Guardar cambios" }).click();

    await expect(dialogo).toBeHidden();
    await expect(page.getByText("Datos guardados.")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: nueva }),
    ).toBeVisible();
    establecimiento.razonSocial = nueva;

    await buscarEnListado();
    await expect(fila()).toContainText(nueva);
  });

  test("[TC-E-043] Plataforma: suspende el establecimiento con un motivo y lo reactiva", async () => {
    await abrirFicha();
    const motivo = "Prueba E2E de suspensión";

    await page.getByRole("button", { name: "Suspender" }).click();
    const suspender = page.getByRole("dialog", {
      name: `¿Suspender ${establecimiento.razonSocial}?`,
    });
    await suspender.getByLabel("Motivo").fill(motivo);
    await suspender
      .getByRole("button", { name: "Suspender establecimiento" })
      .click();

    await expect(suspender).toBeHidden();
    await expect(page.getByText("Establecimiento suspendido.")).toBeVisible();
    await expect(page.getByText(`Motivo: ${motivo}`)).toBeVisible();

    // En el listado aparece con «Suspendidos».
    await buscarEnListado("SUSPENDIDOS");
    await expect(fila()).toHaveCount(1);
    await expect(fila()).toContainText("Suspendido");

    await abrirFicha();
    await page.getByRole("button", { name: "Reactivar" }).click();
    const reactivar = page.getByRole("dialog", {
      name: `¿Reactivar ${establecimiento.razonSocial}?`,
    });
    await reactivar.getByRole("button", { name: "Reactivar" }).click();

    await expect(reactivar).toBeHidden();
    await expect(page.getByText("Establecimiento reactivado.")).toBeVisible();
    await expect(page.getByText(`Motivo: ${motivo}`)).toBeHidden();
    await expect(page.getByRole("button", { name: "Suspender" })).toBeVisible();
  });

  test("[TC-E-044] Plataforma: el listado, la ficha y sus diálogos no tienen errores graves de accesibilidad en celular, tablet y PC (axe-core)", async () => {
    for (const ancho of ANCHOS) {
      await page.setViewportSize({ width: ancho.width, height: ancho.height });

      await buscarEnListado();
      await expect(fila()).toHaveCount(1);
      expect(
        await violacionesGraves(page),
        `listado (${ancho.nombre})`,
      ).toEqual([]);

      await abrirFicha();
      expect(await violacionesGraves(page), `ficha (${ancho.nombre})`).toEqual(
        [],
      );

      // Los diálogos se abren y se cierran sin confirmar nada.
      for (const [boton, titulo] of [
        ["Editar datos", `Editar ${establecimiento.razonSocial}`],
        ["Suspender", `¿Suspender ${establecimiento.razonSocial}?`],
        [
          "Eliminar definitivamente",
          `¿Eliminar ${establecimiento.razonSocial}?`,
        ],
      ]) {
        await page.getByRole("button", { name: boton, exact: true }).click();
        const dialogo = page.getByRole("dialog", { name: titulo });
        await expect(dialogo).toBeVisible();
        expect(
          await violacionesGraves(page),
          `diálogo «${boton}» (${ancho.nombre})`,
        ).toEqual([]);
        await dialogo.getByRole("button", { name: "Cancelar" }).click();
        await expect(dialogo).toBeHidden();
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("[TC-E-045] Plataforma: elimina el establecimiento sin actividad escribiendo el RUT, y deja de aparecer en el listado", async () => {
    await abrirFicha();

    await page
      .getByRole("button", { name: "Eliminar definitivamente" })
      .click();
    const dialogo = page.getByRole("dialog", {
      name: `¿Eliminar ${establecimiento.razonSocial}?`,
    });
    // El foco empieza en «Cancelar» y el botón espera el RUT correcto.
    await expect(
      dialogo.getByRole("button", { name: "Cancelar" }),
    ).toBeFocused();
    const confirmar = dialogo.getByRole("button", {
      name: "Eliminar definitivamente",
    });
    await expect(confirmar).toBeDisabled();
    const campoRut = dialogo.getByLabel("Escribí el RUT para confirmar");
    await campoRut.fill("219999990016");
    await expect(confirmar).toBeDisabled();
    await campoRut.fill(establecimiento.rut);
    await confirmar.click();

    await expect(dialogo.getByRole("status")).toContainText("se eliminó");
    await dialogo.getByRole("button", { name: "Volver al listado" }).click();
    await expect(page).toHaveURL(/\/plataforma$/);

    await buscador().fill(establecimiento.rut);
    await expect(sinCoincidencias()).toBeVisible();
  });
});
