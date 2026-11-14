import {
  AVISO_LINK_CADUCADO,
  AVISO_LINK_CANCELADO,
  AVISO_LINK_ERROR,
  AVISO_LINK_INVALIDO,
  AVISO_LINK_REEMPLAZADO,
  AVISO_LINK_VENCIDO,
  avisoDelLink,
  CODIGO_LINK_CADUCADO,
  CODIGO_LINK_CANCELADO,
  CODIGO_LINK_REEMPLAZADO,
  CODIGO_LINK_VENCIDO,
  esTokenDeLinkValido,
  lineasParaPagar,
  yaEstaPagado,
  type ResumenLinkPago,
} from "@/components/link-pago/link-pago.utils";

// HU-033 (BL-203): página del link de pago (/pagar/<token>).

describe("esTokenDeLinkValido", () => {
  it("acepta un token base64url del largo del link", () => {
    expect(esTokenDeLinkValido("A".repeat(103))).toBe(true);
    expect(esTokenDeLinkValido("a-b_C".repeat(20))).toBe(true);
  });

  it.each([
    ["corto"],
    ["../admin" + "a".repeat(60)],
    ["x".repeat(129)],
    ["con espacios " + "a".repeat(50)],
  ])("rechaza %s", (token) => {
    expect(esTokenDeLinkValido(token)).toBe(false);
  });
});

describe("avisoDelLink", () => {
  it.each([
    [404, undefined, AVISO_LINK_INVALIDO],
    [400, undefined, AVISO_LINK_INVALIDO],
    [403, undefined, AVISO_LINK_INVALIDO],
    [410, CODIGO_LINK_VENCIDO, AVISO_LINK_VENCIDO],
    [410, CODIGO_LINK_REEMPLAZADO, AVISO_LINK_REEMPLAZADO],
    [410, CODIGO_LINK_CANCELADO, AVISO_LINK_CANCELADO],
    [410, CODIGO_LINK_CADUCADO, AVISO_LINK_CADUCADO],
    [410, undefined, AVISO_LINK_REEMPLAZADO],
    [500, undefined, AVISO_LINK_ERROR],
  ])("%i %s", (status, codigo, esperado) => {
    expect(avisoDelLink(status, codigo)).toBe(esperado);
  });
});

const resumen: ResumenLinkPago = {
  pedidoId: "3f2a9c1e-0000-4000-8000-000000000001",
  estadoPedido: "PENDIENTE_PAGO",
  restaurante: { nombre: "La Cantina" },
  mesaNumero: 4,
  lineas: [
    { itemCartaId: "i-1", nombre: "Milanesa", cantidad: 2, precio: "390.00" },
  ],
  consumo: "780.00",
  venceEn: "2026-11-14T23:15:00.000Z",
};

describe("lineasParaPagar y yaEstaPagado", () => {
  it("las líneas con el precio como número, como las usa PagoPedido", () => {
    expect(lineasParaPagar(resumen)).toEqual([
      { itemCartaId: "i-1", nombre: "Milanesa", cantidad: 2, precio: 390 },
    ]);
  });

  it("pagado: cualquier estado que no sea PENDIENTE_PAGO", () => {
    expect(yaEstaPagado(resumen)).toBe(false);
    expect(yaEstaPagado({ estadoPedido: "RECIBIDO" })).toBe(true);
    expect(yaEstaPagado({ estadoPedido: "ENTREGADO" })).toBe(true);
  });
});
