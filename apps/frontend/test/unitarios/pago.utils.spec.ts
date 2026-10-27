import {
  codigoPedido,
  digitoVerificadorCi,
  documentoParaMercadoPago,
  errorDocumento,
  errorEmail,
  errorTitular,
  estadoComprobante,
  etiquetaMarca,
  numeroComprobante,
  urlConsultaSegura,
  firmaCarrito,
  formatearPrecio,
  HEADER_PEDIDO_TOKEN,
  headersAccesoPedido,
  MENSAJE_SIN_ACCESO,
  MENSAJE_VERIFICANDO,
  resultadoDeError,
  resultadoDeEstado,
  rutaPagos,
  seguirConsultando,
  tipoTarjeta,
  TOPE_CONSULTA_MS,
} from "@/components/pago/pago.utils";
import {
  HEADER_MESA_SESION,
  HEADER_MESA_TOKEN,
  type OrigenMenu,
} from "@/components/menu-digital.utils";

// BL-311 (HU-007): pago del comensal con prepago (RD.03) y acceso al pedido
// atado a quien lo hizo (RD.05).

const MESA: OrigenMenu = {
  tipo: "mesa",
  qrToken: "qr-abc",
  sesionMesa: "99999999-9999-4999-8999-999999999999",
};
const PUBLICO: OrigenMenu = {
  tipo: "publico",
  tenantId: "11111111-1111-1111-1111-111111111111",
  restauranteId: "22222222-2222-2222-2222-222222222222",
};

describe("rutas y headers del pago", () => {
  it("POST y GET del pago van a /pedidos/:id/pagos", () => {
    expect(rutaPagos("3cdf1dad-31d6-43c9-9739-11485e0e23f8")).toBe(
      "/pedidos/3cdf1dad-31d6-43c9-9739-11485e0e23f8/pagos",
    );
  });

  it("un id raro no puede cambiar la ruta", () => {
    expect(rutaPagos("../admin")).toBe("/pedidos/..%2Fadmin/pagos");
  });

  it("mesa: se autoriza con el QR y la sesión de la mesa", () => {
    expect(headersAccesoPedido(MESA, "ignorado")).toEqual({
      [HEADER_MESA_TOKEN]: "qr-abc",
      [HEADER_MESA_SESION]: "99999999-9999-4999-8999-999999999999",
    });
  });

  it("pedido para retirar: se autoriza con el token del pedido (X-Pedido-Token)", () => {
    expect(headersAccesoPedido(PUBLICO, "tok-123")).toEqual({
      [HEADER_PEDIDO_TOKEN]: "tok-123",
    });
  });

  it("pedido para retirar sin token: no inventa un header (el backend responde 400)", () => {
    expect(headersAccesoPedido(PUBLICO)).toEqual({});
  });
});

describe("formato", () => {
  it("precio en pesos uruguayos sin decimales", () => {
    const texto = formatearPrecio(48500).replace(/\s/g, " ");
    expect(texto).toContain("48.500");
    expect(texto).not.toContain(",");
  });

  it("código corto del pedido: 6 caracteres del id en mayúsculas", () => {
    expect(codigoPedido("3cdf1dad-31d6-43c9-9739-11485e0e23f8")).toBe("#3CDF1D");
  });
});

describe("firma del carrito (reusar el pedido si no cambió nada)", () => {
  const items = [
    { itemCartaId: "a", cantidad: 2, observacion: "sin sal " },
    { itemCartaId: "b", cantidad: 1 },
  ];

  it("mismo carrito y misma nota: misma firma", () => {
    expect(firmaCarrito(items, "nota")).toBe(firmaCarrito([...items], " nota "));
  });

  it("cambia la cantidad, la nota de un plato o la nota general: otra firma", () => {
    const base = firmaCarrito(items, "nota");
    expect(firmaCarrito([{ ...items[0], cantidad: 3 }, items[1]], "nota")).not.toBe(base);
    expect(firmaCarrito([{ ...items[0], observacion: "con sal" }, items[1]], "nota")).not.toBe(base);
    expect(firmaCarrito(items, "otra")).not.toBe(base);
  });
});

describe("documento del titular", () => {
  it("dígito verificador de la cédula uruguaya", () => {
    expect(digitoVerificadorCi("1234567")).toBe(2);
    expect(digitoVerificadorCi("1111111")).toBe(1);
    // 6 dígitos de cuerpo: se completa con ceros a la izquierda
    expect(digitoVerificadorCi("987654")).toBe(digitoVerificadorCi("0987654"));
  });

  it.each(["1.234.567-2", "1234567-2", "12345672"])(
    "cédula válida con o sin puntos y guion: %s",
    (ci) => {
      expect(errorDocumento("CI", ci)).toBeNull();
    },
  );

  it("cédula con el dígito verificador mal: error claro", () => {
    expect(errorDocumento("CI", "1.234.567-3")).toMatch(/dígito verificador/);
  });

  it("cédula con pocos o demasiados dígitos: error", () => {
    expect(errorDocumento("CI", "12345")).toMatch(/7 u 8 dígitos/);
    expect(errorDocumento("CI", "123456789")).toMatch(/7 u 8 dígitos/);
  });

  it("otro documento (turistas): alcanza con que no esté vacío", () => {
    expect(errorDocumento("OTRO", "AB123456")).toBeNull();
    expect(errorDocumento("OTRO", "  ")).not.toBeNull();
  });

  it("a Mercado Pago la cédula va solo con dígitos", () => {
    expect(documentoParaMercadoPago("CI", "1.234.567-2")).toEqual({
      identificationType: "CI",
      identificationNumber: "12345672",
    });
    expect(documentoParaMercadoPago("OTRO", " AB123 ")).toEqual({
      identificationType: "OTRO",
      identificationNumber: "AB123",
    });
  });
});

describe("otros campos", () => {
  it("correo", () => {
    expect(errorEmail("ana@correo.com.uy")).toBeNull();
    expect(errorEmail(" ana.perez+bistro@correo.uy ")).toBeNull();
    expect(errorEmail("ana@correo")).not.toBeNull();
    expect(errorEmail("")).not.toBeNull();
  });

  it.each([
    ["@correo.com"],
    ["ana@@correo.com"],
    ["ana@cor@reo.com"],
    ["ana @correo.com"],
    ["ana@.com"],
    ["ana@correo.c"],
    ["ana@correo."],
  ])("correo inválido: %s", (correo) => {
    expect(errorEmail(correo)).not.toBeNull();
  });

  it("un texto largo armado para trabar una regex se resuelve al instante", () => {
    const inicio = Date.now();
    expect(errorEmail(`a@${"a.".repeat(50_000)}`)).not.toBeNull();
    expect(Date.now() - inicio).toBeLessThan(100);
  });

  it("titular", () => {
    expect(errorTitular("ANA PEREZ")).toBeNull();
    expect(errorTitular("A")).not.toBeNull();
  });

  it("tipo de tarjeta para el backend: débito o crédito (por defecto)", () => {
    expect(tipoTarjeta("debit_card")).toBe("debit_card");
    expect(tipoTarjeta("credit_card")).toBe("credit_card");
    expect(tipoTarjeta(undefined)).toBe("credit_card");
  });

  it("marca en mayúsculas para el campo del número", () => {
    expect(etiquetaMarca("Visa")).toBe("VISA");
    expect(etiquetaMarca(undefined)).toBeNull();
  });
});

describe("resultado del pago", () => {
  it("402 (tarjeta rechazada): rechazado, con el mensaje del backend", () => {
    expect(
      resultadoDeError(402, "Tu tarjeta no tiene fondos suficientes. No se realizó ningún cargo."),
    ).toEqual({
      tipo: "rechazado",
      mensaje: "Tu tarjeta no tiene fondos suficientes. No se realizó ningún cargo.",
    });
  });

  it.each([503, 409])(
    "%i (pasarela sin respuesta o pago en curso): verificando, nunca se ofrece pagar de nuevo",
    (status) => {
      expect(resultadoDeError(status, "x")).toEqual({
        tipo: "verificando",
        mensaje: MENSAJE_VERIFICANDO,
      });
    },
  );

  it("400 (datos de tarjeta inválidos): error con el mensaje del backend", () => {
    expect(resultadoDeError(400, "Los datos de la tarjeta no son válidos")).toEqual({
      tipo: "error",
      mensaje: "Los datos de la tarjeta no son válidos",
    });
  });

  it("410 (HU-017: mesa cerrada o sesión vencida): el mensaje del backend", () => {
    expect(resultadoDeError(410, "Esta mesa está cerrada.")).toEqual({
      tipo: "error",
      mensaje: "Esta mesa está cerrada.",
    });
    expect(resultadoDeError(410)).toEqual({
      tipo: "error",
      mensaje: MENSAJE_SIN_ACCESO,
    });
  });

  it.each([401, 403, 404])(
    "%i (sin acceso al pedido): error sin detalles internos",
    (status) => {
      expect(resultadoDeError(status, "Este pedido es de otra mesa")).toEqual({
        tipo: "error",
        mensaje: MENSAJE_SIN_ACCESO,
      });
    },
  );

  it("estado del pago: aprobado / rechazado / pendiente o sin pago => verificando", () => {
    expect(resultadoDeEstado("APROBADO")).toEqual({ tipo: "aprobado" });
    expect(resultadoDeEstado("RECHAZADO").tipo).toBe("rechazado");
    expect(resultadoDeEstado("PENDIENTE").tipo).toBe("verificando");
    expect(resultadoDeEstado(undefined).tipo).toBe("verificando");
  });

  it("la consulta periódica se corta al llegar al tope", () => {
    expect(seguirConsultando(0, TOPE_CONSULTA_MS - 1)).toBe(true);
    expect(seguirConsultando(0, TOPE_CONSULTA_MS)).toBe(false);
  });
});

describe("comprobante en la pantalla de pago aprobado", () => {
  it("número del e-Ticket: serie y número con 7 dígitos", () => {
    expect(numeroComprobante("A", 1234)).toBe("A-0001234");
    expect(numeroComprobante("B", 12345678)).toBe("B-12345678");
  });

  it("sin comprobante todavía: emitiendo", () => {
    expect(estadoComprobante({ comprobante: null })).toEqual({ tipo: "emitiendo" });
    expect(estadoComprobante(null)).toEqual({ tipo: "emitiendo" });
  });

  it("con comprobante: texto y enlace de consulta", () => {
    expect(
      estadoComprobante({
        comprobante: {
          serie: "A",
          numero: 1234,
          urlConsulta: "https://www.efactura.dgi.gub.uy/consultaQR/cfe?x",
        },
      }),
    ).toEqual({
      tipo: "emitido",
      texto: "e-Ticket A-0001234",
      urlConsulta: "https://www.efactura.dgi.gub.uy/consultaQR/cfe?x",
    });
  });

  it("comprobante sin enlace: se muestra igual, sin botón", () => {
    expect(
      estadoComprobante({ comprobante: { serie: "A", numero: 1, urlConsulta: null } }),
    ).toEqual({ tipo: "emitido", texto: "e-Ticket A-0000001", urlConsulta: null });
  });

  it.each([
    ["javascript:alert(1)"],
    ["http://sin-tls.example"],
    ["no es una url"],
    [""],
  ])("enlace inseguro o inválido (%s): no se muestra", (url) => {
    expect(urlConsultaSegura(url)).toBeNull();
  });
});
