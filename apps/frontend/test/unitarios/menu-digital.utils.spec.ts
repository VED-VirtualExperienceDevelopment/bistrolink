import {
  alcanzoCantidadMaxima,
  CANTIDAD_MAXIMA_POR_ITEM,
  esTokenQrConFormatoValido,
  etiquetaMesa,
  HEADER_MESA_TOKEN,
  headersMesaQr,
  MENSAJE_QR_INVALIDO,
  MENSAJE_QR_REEMPLAZADO,
  mensajeErrorQr,
  origenPedido,
  RUTA_AUTH_COMENSAL,
  RUTA_AUTH_COMENSAL_MESA,
  RUTA_LLAMAR_MOZO,
  solicitudAuthComensal,
  sumarUnidad,
  type OrigenMenu,
} from "@/components/menu-digital.utils";

// BL-309: los pedidos desde una mesa fallaban porque el frontend pedía el
// token a una ruta que no existía en el backend (404).
// HU-034 (BL-204): en la mesa el frontend solo tiene el token opaco del QR;
// ningún id de tenant, mesa ni restaurante.

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const RESTAURANTE_ID = "22222222-2222-2222-2222-222222222222";
const QR_TOKEN = "AbC-123_xyz";

const MESA: OrigenMenu = { tipo: "mesa", qrToken: QR_TOKEN };
const PUBLICO: OrigenMenu = {
  tipo: "publico",
  tenantId: TENANT_ID,
  restauranteId: RESTAURANTE_ID,
};

describe("rutas y header (tienen que coincidir con el backend)", () => {
  it("auth del link web, auth de la mesa, llamado al mozo y header del QR", () => {
    expect(RUTA_AUTH_COMENSAL).toBe("/auth/comensal");
    expect(RUTA_AUTH_COMENSAL_MESA).toBe("/auth/comensal/mesa");
    expect(RUTA_LLAMAR_MOZO).toBe("/mesas/llamar");
    expect(HEADER_MESA_TOKEN.toLowerCase()).toBe("x-mesa-token");
  });
});

describe("solicitudAuthComensal", () => {
  it("mesa: POST /auth/comensal/mesa solo con el token del QR", () => {
    expect(solicitudAuthComensal(MESA)).toEqual({
      ruta: "/auth/comensal/mesa",
      body: { qrToken: QR_TOKEN },
    });
  });

  it("link web del local: POST /auth/comensal con tenantId y restauranteId", () => {
    expect(solicitudAuthComensal(PUBLICO)).toEqual({
      ruta: "/auth/comensal",
      body: { tenantId: TENANT_ID, restauranteId: RESTAURANTE_ID },
    });
  });
});

describe("origenPedido", () => {
  it("mesa: el body no lleva ningún id (la mesa sale del QR en el servidor)", () => {
    expect(origenPedido(MESA)).toEqual({});
  });

  it("link web del local: el pedido va al restaurante (mesa virtual)", () => {
    expect(origenPedido(PUBLICO)).toEqual({ restauranteId: RESTAURANTE_ID });
  });
});

describe("headersMesaQr", () => {
  it("mesa: manda el token del QR en X-Mesa-Token", () => {
    expect(headersMesaQr(MESA)).toEqual({ [HEADER_MESA_TOKEN]: QR_TOKEN });
  });

  it("link web del local: sin header (el pedido es para retirar)", () => {
    expect(headersMesaQr(PUBLICO)).toEqual({});
  });
});

describe("mensajeErrorQr", () => {
  it("mesa, 410: el QR fue reemplazado", () => {
    expect(mensajeErrorQr(MESA, 410)).toBe(MENSAJE_QR_REEMPLAZADO);
  });

  it("mesa, 404: el QR no es válido", () => {
    expect(mensajeErrorQr(MESA, 404)).toBe(MENSAJE_QR_INVALIDO);
  });

  it.each([400, 403, 429, 500])(
    "mesa, %i: no es un problema del QR (null)",
    (status) => {
      expect(mensajeErrorQr(MESA, status)).toBeNull();
    },
  );

  it.each([404, 410])("link web del local, %i: null (no hay QR)", (status) => {
    expect(mensajeErrorQr(PUBLICO, status)).toBeNull();
  });
});

describe("esTokenQrConFormatoValido", () => {
  it("acepta base64url", () => {
    expect(esTokenQrConFormatoValido("A".repeat(87))).toBe(true);
    expect(esTokenQrConFormatoValido(QR_TOKEN)).toBe(true);
  });

  it.each([
    ["vacío", ""],
    ["con barra (otra ruta de la API)", "../admin"],
    ["con caracteres de base64 común", "abc+def/="],
    ["con espacios", "abc def"],
    ["más largo que 128", "A".repeat(129)],
  ])("rechaza un token %s", (_caso, token) => {
    expect(esTokenQrConFormatoValido(token)).toBe(false);
  });
});

describe("etiquetaMesa", () => {
  it("muestra el número de la mesa", () => {
    expect(etiquetaMesa(7)).toBe("Mesa 7");
  });

  it("sin número, un texto genérico", () => {
    expect(etiquetaMesa()).toBe("Mesa asignada");
  });
});

describe("Tope de unidades por ítem en el carrito (BL-425)", () => {
  it("el tope es 99, igual que en el backend", () => {
    expect(CANTIDAD_MAXIMA_POR_ITEM).toBe(99);
  });

  it("sumarUnidad suma de a una y no pasa del tope", () => {
    expect(sumarUnidad(1)).toBe(2);
    expect(sumarUnidad(98)).toBe(99);
    expect(sumarUnidad(99)).toBe(99);
  });

  it("alcanzoCantidadMaxima es true recién en el tope", () => {
    expect(alcanzoCantidadMaxima(98)).toBe(false);
    expect(alcanzoCantidadMaxima(99)).toBe(true);
  });
});
