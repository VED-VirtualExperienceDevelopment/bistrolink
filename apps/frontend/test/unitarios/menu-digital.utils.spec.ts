import {
  alcanzoCantidadMaxima,
  CANTIDAD_MAXIMA_POR_ITEM,
  CODIGO_ESTABLECIMIENTO_SUSPENDIDO,
  CODIGO_MESA_CERRADA,
  CODIGO_SESION_VENCIDA,
  codigoDeError,
  esEstablecimientoSuspendido,
  esTokenQrConFormatoValido,
  etiquetaMesa,
  HEADER_MESA_SESION,
  HEADER_MESA_TOKEN,
  headersMesaQr,
  MENSAJE_MESA_CERRADA,
  MENSAJE_QR_INVALIDO,
  MENSAJE_QR_REEMPLAZADO,
  MENSAJE_SESION_VENCIDA,
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

const SESION = "99999999-9999-4999-8999-999999999999";
const MESA: OrigenMenu = { tipo: "mesa", qrToken: QR_TOKEN, sesionMesa: SESION };
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
    expect(HEADER_MESA_SESION.toLowerCase()).toBe("x-mesa-sesion");
  });
});

describe("solicitudAuthComensal", () => {
  it("mesa: POST /auth/comensal/mesa con el token del QR y la sesión (HU-017)", () => {
    expect(solicitudAuthComensal(MESA)).toEqual({
      ruta: "/auth/comensal/mesa",
      body: { qrToken: QR_TOKEN, sesionMesa: SESION },
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
  it("mesa: manda el token del QR y la sesión de la mesa (HU-017)", () => {
    expect(headersMesaQr(MESA)).toEqual({
      [HEADER_MESA_TOKEN]: QR_TOKEN,
      [HEADER_MESA_SESION]: SESION,
    });
  });

  it("link web del local: sin header (el pedido es para retirar)", () => {
    expect(headersMesaQr(PUBLICO)).toEqual({});
  });
});

describe("mensajeErrorQr", () => {
  it("mesa, 410: el QR fue reemplazado", () => {
    expect(mensajeErrorQr(MESA, 410)).toBe(MENSAJE_QR_REEMPLAZADO);
  });

  it("HU-017 (BL-60): 410 con código: mesa cerrada o sesión vencida", () => {
    expect(mensajeErrorQr(MESA, 410, CODIGO_MESA_CERRADA)).toBe(
      MENSAJE_MESA_CERRADA,
    );
    expect(mensajeErrorQr(MESA, 410, CODIGO_SESION_VENCIDA)).toBe(
      MENSAJE_SESION_VENCIDA,
    );
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

describe("BL-413: establecimiento suspendido", () => {
  it("[TC-U-142] reconoce el 403 con el código de suspensión y no otros 403", () => {
    expect(
      esEstablecimientoSuspendido(403, {
        statusCode: 403,
        message: "Este restaurante no está disponible por el momento.",
        codigo: CODIGO_ESTABLECIMIENTO_SUSPENDIDO,
      }),
    ).toBe(true);
    // 403 de la mesa del QR u otro rol: sin el código.
    expect(
      esEstablecimientoSuspendido(403, {
        statusCode: 403,
        message: "Forbidden",
      }),
    ).toBe(false);
    expect(esEstablecimientoSuspendido(403, null)).toBe(false);
    expect(esEstablecimientoSuspendido(403, "texto")).toBe(false);
    expect(
      esEstablecimientoSuspendido(404, {
        codigo: CODIGO_ESTABLECIMIENTO_SUSPENDIDO,
      }),
    ).toBe(false);
  });
});

describe("codigoDeError (HU-017, BL-60)", () => {
  it("lee el código del cuerpo del error", () => {
    expect(codigoDeError({ statusCode: 410, codigo: "MESA_CERRADA" })).toBe(
      "MESA_CERRADA",
    );
  });

  it.each([null, undefined, "texto", { codigo: 3 }, {}])(
    "sin código válido: undefined (%p)",
    (cuerpo) => {
      expect(codigoDeError(cuerpo)).toBeUndefined();
    },
  );
});
