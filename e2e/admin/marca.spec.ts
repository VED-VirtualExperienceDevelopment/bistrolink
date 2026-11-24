import { test, expect } from "../support/auth";
import { MENU_URL_PATH } from "../support/ids";
import {
  LOGO_PNG,
  PORTADA_PNG,
  abrirConfiguracionDeMarca,
  guardarCambios,
  restaurarMarca,
  type SesionMarca,
} from "../support/marca";

// HU-043 (BL-535): marca propia del local, de Configuración a la carta.
//
// Cambia la marca del establecimiento del seed, así que corre en el
// proyecto `chromium-configuracion`, después de los demás (ver
// playwright.config.ts). Cada test deja la marca como estaba.

test.describe("Marca del local (HU-043)", () => {
  // Los dos tests cambian la misma configuración: uno después del otro.
  test.describe.configure({ mode: "serial" });

  let sesion: SesionMarca | undefined;

  test.afterEach(async ({ kdsPageAdmin: page }) => {
    if (sesion) await restaurarMarca(page, sesion);
    sesion = undefined;
  });

  test("[TC-E-114] HU-043: el Administrador elige la plantilla con el teclado y sube el logo; la carta los muestra", async ({
    kdsPageAdmin: page,
  }) => {
    sesion = await abrirConfiguracionDeMarca(page);
    expect(sesion.original.plantilla, "el seed arranca en la Clásica").toBe(
      "clasica",
    );

    // Las 4 plantillas son botones de opción de un grupo propio (en la
    // pantalla hay otros, como el proveedor de CFE): con las flechas se pasa
    // de la Clásica a la Gourmet, y la elegida dice «Elegida».
    const plantillas = page.getByRole("group", { name: "Estilo del menú" });
    const clasica = plantillas.getByRole("radio", { name: /^Clásica/ });
    const gourmet = plantillas.getByRole("radio", { name: /^Gourmet/ });
    await expect(plantillas.getByRole("radio")).toHaveCount(4);
    await clasica.focus();
    await page.keyboard.press("ArrowRight");
    await expect(gourmet).toBeChecked();
    await expect(gourmet).toBeFocused();
    await expect(
      plantillas.getByRole("radio", { name: /^Gourmet.*Elegida/ }),
    ).toBeVisible();

    // Logo por la carga segura (destino `marca`).
    await page.locator("#logo-local").setInputFiles(LOGO_PNG);
    await expect(
      page.getByText("El logo nuevo se aplica al guardar los cambios."),
    ).toBeVisible({ timeout: 30_000 });
    await guardarCambios(page);

    // La carta por enlace: el logo en la barra (en lugar de «BistroLink»)
    // y los colores de la Gourmet (#5c1a2b = 92 26 43).
    await page.goto(MENU_URL_PATH);
    const barra = page.getByRole("navigation").first();
    const logo = barra.getByRole("img", { name: sesion.original.nombre });
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute(
      "src",
      /\/menu\/marca\/[0-9a-f-]+\.webp/,
    );
    await expect(barra.getByText("BistroLink", { exact: true })).toHaveCount(0);
    const colorDeMarca = await barra.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--brand-primary").trim(),
    );
    expect(colorDeMarca).toBe("92 26 43");
  });

  test("[TC-E-115] HU-043: el Administrador cambia el nombre y sube la portada; la carta muestra los dos", async ({
    kdsPageAdmin: page,
  }) => {
    sesion = await abrirConfiguracionDeMarca(page);
    const nombre = `${sesion.original.nombre} E2E`;

    await page.getByLabel("Nombre del local").fill(nombre);
    // La vista previa de las tarjetas y del banner toma el nombre nuevo.
    await expect(
      page.getByRole("figure").filter({ hasText: "Celular" }),
    ).toContainText(nombre);

    // Portada por la carga segura (destino `portada`).
    await page.locator("#portada-local").setInputFiles(PORTADA_PNG);
    await expect(
      page.getByText("La portada nueva se aplica al guardar los cambios."),
    ).toBeVisible({ timeout: 30_000 });
    await guardarCambios(page);

    // La carta: el nombre nuevo en el título y la pestaña, y la portada en
    // el banner, completa (object-contain).
    await page.goto(MENU_URL_PATH);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(nombre);
    await expect(page).toHaveTitle(new RegExp(nombre));
    const portada = page.locator('section img[src*="/menu/portada/"]').last();
    await expect(portada).toBeVisible();
    await expect(portada).toHaveClass(/object-contain/);
  });
});
