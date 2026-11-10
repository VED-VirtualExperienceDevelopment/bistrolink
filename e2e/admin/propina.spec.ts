import type { Page } from "@playwright/test";
import { test, expect } from "../support/auth";
import { ITEM_DISPONIBLE, MESA_ID } from "../support/ids";
import { continuarAlPago, pagarConTarjetaDePrueba } from "../support/pago";

// HU-022 (BL-496): la propina en el pago del comensal, en el cobro del mozo y
// en los reportes.
//
// El comensal en la mesa elige una propina de $ 50 («Otro monto»: el seed
// no trae porcentajes sugeridos, así no se toca la configuración del
// establecimiento). Un pedido para retirar no sirve para el cobro del mozo:
// no puede pedir efectivo y su propina solo se guarda al pagar con tarjeta.
//
// - TC-E-093 y TC-E-094: el comensal avisa al mozo (la pantalla guarda la
//   propina con un PUT justo antes) y el mozo cobra en efectivo o con el POS
//   (el aviso de efectivo no bloquea el cobro con el POS).
// - TC-E-096: el comensal paga con tarjeta (sandbox de Mercado Pago, como
//   pago.spec.ts): ve el total con la propina y la pantalla la guarda.
// - TC-E-097: «Sin propina» deja el total en el consumo (solo pantalla).
// - TC-E-095: la forma del reporte, sin depender de que haya ventas.
//
// El consumo es $ 590 (Milanesa a la napolitana, seed), así que con la
// propina el total es $ 640.
//
// BL-477: al terminar, el pedido lo cierra el fixture pedidosDeTest.

const COBROS_PATH = "/admin/cobros";
const REPORTES_PATH = "/admin/reportes";

const CONSUMO = 590;
const PROPINA = 50;
const TOTAL_CON_PROPINA = 640;

/** Mismo código que muestran la pantalla del comensal y la del mozo. */
const codigoDelPedido = (pedidoId: string) =>
  `#${pedidoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

/** El comensal arma el pedido desde el QR de la mesa y llega a «Pagá tu pedido». */
async function pedirEnLaMesa(
  page: Page,
  rutaDeLaMesa: string,
): Promise<string> {
  await page.goto(rutaDeLaMesa);
  await expect(page.getByText(ITEM_DISPONIBLE)).toBeVisible();
  await page
    .getByRole("button", {
      name: new RegExp(`Agregar ${ITEM_DISPONIBLE}`, "i"),
    })
    .click();
  return continuarAlPago(page);
}

/** «Otro monto»: $ 50, sin centavos. */
async function elegirOtroMonto(page: Page, monto: number): Promise<void> {
  await page.getByRole("button", { name: "Otro monto" }).click();
  await page.getByLabel("Monto de la propina (en pesos)").fill(`${monto}`);
  await page.getByRole("button", { name: "Aplicar" }).click();
}

/**
 * El resumen del selector de propina: la pantalla tiene otro «Consumo» más
 * arriba (con el IVA incluido), por eso se apunta al de aria-live.
 */
function resumenDePropina(page: Page) {
  return page.locator('dl[aria-live="polite"]');
}

/**
 * El comensal pide efectivo con una propina de $ 50 y avisa al mozo.
 * Devuelve el id del pedido y su código.
 */
async function pedirConPropinaYAvisar(
  page: Page,
  rutaDeLaMesa: string,
): Promise<{ pedidoId: string; codigo: string }> {
  const pedidoId = await pedirEnLaMesa(page, rutaDeLaMesa);
  await elegirOtroMonto(page, PROPINA);
  await expect(resumenDePropina(page)).toContainText(
    new RegExp(`Total\\s*\\$\\s*${TOTAL_CON_PROPINA}`),
  );

  // Efectivo: al avisar al mozo, la pantalla guarda la propina antes.
  const efectivo = page.getByRole("radio", { name: /Efectivo/ });
  await expect(efectivo).toBeVisible({ timeout: 10000 });
  await efectivo.check();
  await page.getByLabel("¿Con cuánto vas a pagar?").fill("10000");
  const [guardada, solicitud] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().endsWith(`/pedidos/${pedidoId}/pagos/propina`) &&
        res.request().method() === "PUT",
    ),
    page.waitForResponse(
      (res) =>
        res.url().endsWith(`/pedidos/${pedidoId}/pagos/solicitud-efectivo`) &&
        res.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Avisar al mozo" }).click(),
  ]);
  expect(guardada.status()).toBe(200);
  expect(Number(((await guardada.json()) as { propina: string }).propina)).toBe(
    PROPINA,
  );
  expect(solicitud.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Esperando al mozo" }),
  ).toBeVisible();

  return { pedidoId, codigo: codigoDelPedido(pedidoId) };
}

/** La fila del pedido en «Cobros pendientes», con la propina a la vista. */
async function filaConPropina(page: Page, codigo: string) {
  await page.goto(COBROS_PATH);
  await expect(
    page.getByRole("heading", { name: "Cobros pendientes" }),
  ).toBeVisible({ timeout: 15000 });
  const fila = page
    .getByRole("listitem")
    .filter({ hasText: `Pedido ${codigo}` });
  await expect(fila).toBeVisible({ timeout: 15000 });
  // La lista muestra el total con la propina y cuánto es de propina.
  await expect(fila).toContainText(new RegExp(`\\$\\s*${TOTAL_CON_PROPINA}`));
  await expect(fila).toContainText(
    new RegExp(`Incluye propina de \\$\\s*${PROPINA}`),
  );
  return fila;
}

test.describe("BL-496: propina en el pago, en los cobros del mozo y en los reportes", () => {
  test("[TC-E-093] HU-022: el mozo ve la propina del comensal en la lista, la cobra en efectivo con el desglose y el comensal pasa a cocina", async ({
    page,
    kdsPageMozo,
    qrMesas,
  }) => {
    test.slow();
    const { codigo } = await pedirConPropinaYAvisar(
      page,
      qrMesas.ruta(MESA_ID),
    );

    const fila = await filaConPropina(kdsPageMozo, codigo);
    await fila.getByRole("button", { name: "Cobrar en efectivo" }).click();

    // El desglose: consumo, propina y total. El mozo no puede cambiarla.
    const dialogo = kdsPageMozo.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText("Consumo");
    await expect(dialogo).toContainText("Propina");
    await expect(dialogo).toContainText(
      new RegExp(`\\$\\s*${TOTAL_CON_PROPINA}`),
    );
    await expect(dialogo.getByLabel("Monto recibido")).toHaveValue("10000.00");

    const [cobro] = await Promise.all([
      kdsPageMozo.waitForResponse(
        (res) =>
          res.url().endsWith("/cobros/efectivo") &&
          res.request().method() === "POST",
      ),
      dialogo.getByRole("button", { name: "Confirmar cobro" }).click(),
    ]);
    expect(cobro.status()).toBe(201);
    // Se manda el total que el mozo estaba viendo.
    const cuerpo = cobro.request().postDataJSON() as {
      totalEsperado?: number | string;
    };
    expect(Number(cuerpo.totalEsperado)).toBe(TOTAL_CON_PROPINA);

    await expect(
      page.getByRole("heading", { name: "¡Tu pedido ya está en cocina!" }),
    ).toBeVisible({ timeout: 20000 });
  });

  test("[TC-E-094] HU-022: el mozo cobra con el POS el total con la propina y el pedido sale de la lista de pendientes", async ({
    page,
    kdsPageMozo,
    qrMesas,
  }) => {
    test.slow();
    const { codigo } = await pedirConPropinaYAvisar(
      page,
      qrMesas.ruta(MESA_ID),
    );

    const fila = await filaConPropina(kdsPageMozo, codigo);
    await fila.getByRole("button", { name: "Cobrar con el POS" }).click();

    const dialogo = kdsPageMozo.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText("Consumo");
    await expect(dialogo).toContainText("Propina");
    await expect(dialogo).toContainText("Total a cobrar en el POS");
    await expect(dialogo).toContainText(
      new RegExp(`\\$\\s*${TOTAL_CON_PROPINA}`),
    );
    await dialogo.getByRole("radio", { name: "Débito" }).check();
    await dialogo.getByLabel("Número de autorización").fill("e2e456");

    const [cobro] = await Promise.all([
      kdsPageMozo.waitForResponse(
        (res) =>
          res.url().endsWith("/cobros/pos") &&
          res.request().method() === "POST",
      ),
      dialogo.getByRole("button", { name: "Registrar cobro" }).click(),
    ]);
    expect(cobro.status()).toBe(201);
    const cuerpo = cobro.request().postDataJSON() as {
      totalEsperado?: number | string;
    };
    expect(Number(cuerpo.totalEsperado)).toBe(TOTAL_CON_PROPINA);
    await expect(
      kdsPageMozo.getByText(`Cobro registrado: pedido ${codigo}`),
    ).toBeVisible();
    await expect(fila).toHaveCount(0, { timeout: 10000 });
  });

  test("[TC-E-095] HU-022: Reportes muestra la tarjeta de propinas y la API trae las propinas del período y de cada hora", async ({
    kdsPageAdmin: page,
  }) => {
    const [respuesta] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`${REPORTES_PATH}?`) &&
          res.request().method() === "GET",
      ),
      page.goto(REPORTES_PATH),
    ]);
    expect(respuesta.status()).toBe(200);

    // La forma del reporte, haya o no ventas.
    const reporte = (await respuesta.json()) as {
      resumen: { propinas: Record<string, unknown> };
      ventasPorHora: { propina: unknown }[];
    };
    expect(reporte.resumen.propinas).toEqual({
      total: expect.any(Number),
      pedidosConPropina: expect.any(Number),
      porcentajeDeVentas: expect.any(Number),
    });
    for (const hora of reporte.ventasPorHora) {
      expect(typeof hora.propina).toBe("number");
    }

    // La tarjeta, aparte de «Total vendido».
    await expect(
      page.getByRole("heading", { name: "Total vendido" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Propinas", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Nadie dejó propina|dejaron propina|dejó propina/),
    ).toBeVisible();
  });

  test("[TC-E-096] HU-022: el comensal en la mesa elige una propina, ve el total con la propina en «Pagar», paga con tarjeta y el pedido llega a cocina", async ({
    page,
    qrMesas,
  }) => {
    // Un pago contra el sandbox de Mercado Pago (ver support/pago.ts).
    test.slow();
    const pedidoId = await pedirEnLaMesa(page, qrMesas.ruta(MESA_ID));

    // El local puede preseleccionar una propina (la configura el
    // administrador y en staging queda guardada): se parte de «Sin propina»
    // para que el botón cobre solo el consumo, sin depender de eso.
    await page.getByRole("button", { name: "Sin propina" }).click();
    await expect(
      page.getByRole("button", { name: /^Pagar\s.*590/ }),
    ).toBeVisible({ timeout: 15000 });

    // Con la propina, el botón y el resumen pasan al total.
    await elegirOtroMonto(page, PROPINA);
    await expect(resumenDePropina(page)).toContainText(
      new RegExp(`Total\\s*\\$\\s*${TOTAL_CON_PROPINA}`),
    );
    await expect(
      page.getByRole("button", { name: /^Pagar\s.*640/ }),
    ).toBeVisible();

    // Al pagar, la pantalla guarda la propina (PUT) antes de cobrar.
    const propinaGuardada = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/pedidos/${pedidoId}/pagos/propina`) &&
        res.request().method() === "PUT",
    );
    expect(await pagarConTarjetaDePrueba(page, "APRO")).toBe(201);
    const guardada = await propinaGuardada;
    expect(guardada.status()).toBe(200);
    expect(
      Number(((await guardada.json()) as { propina: string }).propina),
    ).toBe(PROPINA);

    await expect(
      page.getByRole("heading", { name: "¡Tu pedido ya está en cocina!" }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("[TC-E-097] HU-022: «Sin propina» quita la propina elegida y el total vuelve a ser el consumo", async ({
    page,
    qrMesas,
  }) => {
    await pedirEnLaMesa(page, qrMesas.ruta(MESA_ID));

    await elegirOtroMonto(page, PROPINA);
    await expect(resumenDePropina(page)).toContainText("Propina");
    await expect(resumenDePropina(page)).toContainText(
      new RegExp(`Total\\s*\\$\\s*${TOTAL_CON_PROPINA}`),
    );

    await page.getByRole("button", { name: "Sin propina" }).click();
    await expect(resumenDePropina(page)).not.toContainText("Propina");
    await expect(resumenDePropina(page)).toContainText(
      new RegExp(`Total\\s*\\$\\s*${CONSUMO}`),
    );
    await expect(
      page.getByRole("button", { name: /^Pagar\s.*590/ }),
    ).toBeVisible();
  });
});
