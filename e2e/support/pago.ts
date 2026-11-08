import { expect, test, type Page } from "@playwright/test";

/**
 * BL-311 (HU-007): prepago (RD.03). El carrito confirmado crea el pedido en
 * PENDIENTE_PAGO y recién con el pago aprobado llega a cocina. Los E2E que
 * necesitan un pedido en el KDS pasan por acá: confirman el carrito y pagan
 * con una tarjeta de prueba del sandbox de Mercado Pago.
 *
 * Requisitos del entorno (staging en CI, o local):
 * - Backend con MP_ACCESS_TOKEN de prueba (sandbox).
 * - Frontend construido con NEXT_PUBLIC_MP_PUBLIC_KEY de prueba.
 *
 * En el sandbox, el resultado lo decide el NOMBRE del titular: APRO aprueba,
 * FUND rechaza por fondos insuficientes (mismo criterio que
 * apps/backend/scripts/sandbox-pagos.ts).
 */
export const TARJETA_PRUEBA = {
  // Mastercard de prueba de Mercado Pago Uruguay.
  numero: "5031755734530604",
  marca: "MASTERCARD",
  vencimiento: "11/30",
  cvv: "123",
  // Cédula válida (dígito verificador correcto): el formulario la valida.
  documento: "1.234.567-2",
  email: "comensal.e2e@testuser.com",
} as const;

export type TitularPrueba = "APRO" | "FUND";

/**
 * Confirma el carrito («Continuar al pago») y devuelve el id del pedido
 * creado (todavía en PENDIENTE_PAGO, no está en el KDS).
 */
export async function continuarAlPago(page: Page): Promise<string> {
  const [pedidoRes] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().endsWith("/pedidos") && res.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Continuar al pago" }).click(),
  ]);
  expect(pedidoRes.status()).toBe(201);
  const { id } = (await pedidoRes.json()) as { id: string };

  await expect(
    page.getByRole("heading", { name: "Pagá tu pedido" }),
  ).toBeVisible({ timeout: 10000 });
  return id;
}

/**
 * Los campos de tarjeta son iframes de Mercado Pago (Secure Fields): el
 * número, el vencimiento y el CVV nunca pasan por nuestro DOM. Se ubica el
 * iframe por la etiqueta visible del campo (label[for] -> contenedor).
 *
 * Cada iframe de Mercado Pago trae los tres inputs y oculta (class="hide")
 * los que no corresponden: por eso se busca el input por su name, no el
 * primero que aparezca.
 */
async function llenarCampoSeguro(
  page: Page,
  etiqueta: string,
  nombreInput: "cardNumber" | "expirationDate" | "securityCode",
  valor: string,
): Promise<void> {
  const contenedorId = await page
    .locator("label", { hasText: etiqueta })
    .getAttribute("for");
  expect(contenedorId, `sin contenedor para «${etiqueta}»`).toBeTruthy();

  // useId() genera ids con «:» (no válidos en un selector #id).
  const iframe = page.locator(`[id="${contenedorId}"] iframe`);
  await expect(iframe).toBeVisible({ timeout: 15000 });
  const input = iframe.contentFrame().locator(`input[name="${nombreInput}"]`);
  await input.click();
  // Tecla por tecla: el SDK formatea y valida en cada pulsación.
  await input.pressSequentially(valor, { delay: 30 });
}

/**
 * Completa el formulario con la tarjeta de prueba y paga. Devuelve el status
 * HTTP del POST /pedidos/:id/pagos (201 aprobado, 402 rechazado).
 */
export async function pagarConTarjetaDePrueba(
  page: Page,
  titular: TitularPrueba = "APRO",
): Promise<number> {
  // El pago real contra el sandbox (cargar el SDK, tokenizar, cobrar) suma
  // varios segundos a lo que ya hace el test: se le da margen extra.
  test.info().setTimeout(test.info().timeout + 30_000);

  await llenarCampoSeguro(
    page,
    "Número de tarjeta",
    "cardNumber",
    TARJETA_PRUEBA.numero,
  );
  // Con los primeros dígitos, el formulario consulta a Mercado Pago qué
  // tarjeta es (getPaymentMethods) y muestra la marca. Hasta que esa
  // consulta vuelve, «Pagar» responde «Revisá el número de la tarjeta»:
  // se espera la marca antes de seguir.
  await expect(
    page.getByText(TARJETA_PRUEBA.marca, { exact: true }),
  ).toBeVisible({ timeout: 10000 });

  await llenarCampoSeguro(
    page,
    "Vencimiento",
    "expirationDate",
    TARJETA_PRUEBA.vencimiento,
  );
  await llenarCampoSeguro(
    page,
    "Código de seguridad",
    "securityCode",
    TARJETA_PRUEBA.cvv,
  );

  await page.getByLabel("Nombre en la tarjeta").fill(titular);
  await page.getByLabel("Documento del titular").fill(TARJETA_PRUEBA.documento);
  await page
    .getByLabel("Correo para tu comprobante")
    .fill(TARJETA_PRUEBA.email);

  // «Pagar $ 590» la primera vez; «Reintentar pago ($ 590)» después de un
  // rechazo (PagoPedido.tsx).
  const botonPagar = page.getByRole("button", {
    name: /^(Pagar|Reintentar pago) /,
  });
  await expect(botonPagar).toBeEnabled({ timeout: 15000 });

  const [pagoRes] = await Promise.all([
    page.waitForResponse(
      (res) =>
        /\/pedidos\/[^/]+\/pagos$/.test(res.url()) &&
        res.request().method() === "POST",
      { timeout: 30000 },
    ),
    botonPagar.click(),
  ]);
  return pagoRes.status();
}

/**
 * Recorrido completo del comensal hasta «¡Tu pedido ya está en cocina!».
 * Devuelve el id del pedido (ya en RECIBIDO, visible en el KDS).
 */
export async function confirmarYPagar(page: Page): Promise<string> {
  const pedidoId = await continuarAlPago(page);
  expect(await pagarConTarjetaDePrueba(page, "APRO")).toBe(201);
  await expect(
    page.getByRole("heading", { name: "¡Tu pedido ya está en cocina!" }),
  ).toBeVisible({ timeout: 15000 });
  return pedidoId;
}
