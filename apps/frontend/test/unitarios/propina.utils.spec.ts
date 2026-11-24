import {
  MENSAJE_ERROR_PROPINA,
  MENSAJE_MONTO_PROPINA_INVALIDO,
  SIN_PROPINA,
  cuerpoDePropina,
  eleccionAlAbrir,
  eleccionGuardada,
  errorMontoPropina,
  etiquetaDePropina,
  evaluarMontoPropina,
  hayQueGuardarPropina,
  mensajeErrorPropina,
  mismaEleccion,
  montoDePropina,
  opcionesDePropina,
  topeDePropina,
  totalConPropina,
  type EleccionPropina,
  type PropinaDelLocal,
  type TotalesDelPedido,
} from "@/components/pago/propina.utils";
import { MENSAJE_SIN_ACCESO } from "@/components/pago/pago.utils";

// HU-022 (BL-495): propina en la pantalla de pago del comensal.

const PORCENTAJE = (porcentaje: number): EleccionPropina => ({
  tipo: "porcentaje",
  porcentaje,
});
const MONTO = (monto: number): EleccionPropina => ({ tipo: "monto", monto });

/** Totales de un pedido de $ 590 con la elección guardada que se indique. */
function totales(
  guardada: Partial<
    Pick<TotalesDelPedido, "propinaPorcentaje" | "propinaMonto">
  > = {},
): TotalesDelPedido {
  return {
    consumo: "590.00",
    propina: "0.00",
    total: "590.00",
    propinaPorcentaje: null,
    propinaMonto: null,
    ...guardada,
  };
}

const LOCAL_SIN_PRESELECCION: PropinaDelLocal = {
  sugeridas: [5, 10, 15],
  preseleccionada: false,
};
const LOCAL_CON_PRESELECCION: PropinaDelLocal = {
  sugeridas: [5, 10, 15],
  preseleccionada: true,
};

describe("cálculo de la propina (mismo redondeo que el backend)", () => {
  it("porcentaje sobre el consumo, al peso: 5 % = $ 30, 10 % = $ 59, 15 % = $ 89 sobre $ 590", () => {
    expect(montoDePropina(590, PORCENTAJE(5))).toBe(30);
    expect(montoDePropina(590, PORCENTAJE(10))).toBe(59);
    expect(montoDePropina(590, PORCENTAJE(15))).toBe(89);
  });

  it(".5 redondea hacia arriba (15 % de 1250 = 187,5 → 188)", () => {
    expect(montoDePropina(1250, PORCENTAJE(15))).toBe(188);
  });

  it("con consumo con centésimos (el backend lo manda como texto)", () => {
    expect(montoDePropina("590.50", PORCENTAJE(10))).toBe(59);
    expect(montoDePropina("590.50", PORCENTAJE(5))).toBe(30);
  });

  it("monto libre tal cual; sin elección, cero", () => {
    expect(montoDePropina(590, MONTO(100))).toBe(100);
    expect(montoDePropina(590, SIN_PROPINA)).toBe(0);
  });

  it("nunca pasa el tope: el consumo en pesos enteros, hacia abajo", () => {
    expect(topeDePropina(590)).toBe(590);
    expect(topeDePropina("590.50")).toBe(590);
    expect(montoDePropina(590, MONTO(1000))).toBe(590);
    expect(montoDePropina("590.50", PORCENTAJE(100))).toBe(590);
  });

  it("el total es el consumo más la propina", () => {
    expect(totalConPropina(590, PORCENTAJE(10))).toBe(649);
    expect(totalConPropina(590, MONTO(100))).toBe(690);
    expect(totalConPropina(590, SIN_PROPINA)).toBe(590);
    expect(totalConPropina("590.50", PORCENTAJE(10))).toBe(649.5);
  });

  it("una tarjeta por porcentaje sugerido, con su monto; sin sugeridos, ninguna", () => {
    expect(opcionesDePropina(590, [5, 10, 15])).toEqual([
      { porcentaje: 5, monto: 30 },
      { porcentaje: 10, monto: 59 },
      { porcentaje: 15, monto: 89 },
    ]);
    expect(opcionesDePropina(590, [])).toEqual([]);
  });
});

describe("elección guardada y comparación", () => {
  it("lee del pedido el porcentaje, el monto libre o la ausencia de propina", () => {
    expect(eleccionGuardada(totales({ propinaPorcentaje: 10 }))).toEqual(
      PORCENTAJE(10),
    );
    expect(eleccionGuardada(totales({ propinaMonto: 120 }))).toEqual(
      MONTO(120),
    );
    expect(eleccionGuardada(totales())).toEqual(SIN_PROPINA);
  });

  it("dos elecciones son la misma solo si coinciden en tipo y valor", () => {
    expect(mismaEleccion(PORCENTAJE(10), PORCENTAJE(10))).toBe(true);
    expect(mismaEleccion(PORCENTAJE(10), PORCENTAJE(15))).toBe(false);
    expect(mismaEleccion(MONTO(59), MONTO(59))).toBe(true);
    expect(mismaEleccion(MONTO(59), MONTO(60))).toBe(false);
    // Mismo número, distinto tipo: un 10 % no es $ 10.
    expect(mismaEleccion(PORCENTAJE(10), MONTO(10))).toBe(false);
    expect(mismaEleccion(SIN_PROPINA, SIN_PROPINA)).toBe(true);
    expect(mismaEleccion(SIN_PROPINA, PORCENTAJE(10))).toBe(false);
    expect(mismaEleccion(MONTO(5), SIN_PROPINA)).toBe(false);
  });
});

describe("qué propina muestra la pantalla al abrir", () => {
  it("local sin preselección y nada guardado: sin propina", () => {
    expect(eleccionAlAbrir(totales(), LOCAL_SIN_PRESELECCION)).toEqual({
      eleccion: SIN_PROPINA,
      sugerida: false,
    });
  });

  it("local con preselección y el 10 % entre las sugeridas: marca el 10 % como sugerida", () => {
    expect(eleccionAlAbrir(totales(), LOCAL_CON_PRESELECCION)).toEqual({
      eleccion: PORCENTAJE(10),
      sugerida: true,
    });
  });

  it("con preselección pero sin el 10 % entre las sugeridas: no marca nada", () => {
    expect(
      eleccionAlAbrir(totales(), {
        sugeridas: [5, 15],
        preseleccionada: true,
      }),
    ).toEqual({ eleccion: SIN_PROPINA, sugerida: false });
    expect(
      eleccionAlAbrir(totales(), { sugeridas: [], preseleccionada: true }),
    ).toEqual({ eleccion: SIN_PROPINA, sugerida: false });
  });

  it("una elección ya guardada en el pedido gana sobre la preselección y no es «sugerida»", () => {
    expect(
      eleccionAlAbrir(
        totales({ propinaPorcentaje: 15 }),
        LOCAL_CON_PRESELECCION,
      ),
    ).toEqual({ eleccion: PORCENTAJE(15), sugerida: false });
    expect(
      eleccionAlAbrir(totales({ propinaMonto: 80 }), LOCAL_CON_PRESELECCION),
    ).toEqual({ eleccion: MONTO(80), sugerida: false });
  });
});

describe("guardar la propina antes de pagar", () => {
  it("el body lleva el porcentaje o el monto, nunca el monto calculado; sin propina va vacío", () => {
    expect(cuerpoDePropina(PORCENTAJE(10))).toEqual({ porcentaje: 10 });
    expect(cuerpoDePropina(MONTO(120))).toEqual({ monto: 120 });
    expect(cuerpoDePropina(SIN_PROPINA)).toEqual({});
  });

  it("una preselección sin tocar se guarda (el pedido todavía no la tiene)", () => {
    expect(hayQueGuardarPropina(PORCENTAJE(10), totales())).toBe(true);
  });

  it("no se guarda lo que el pedido ya tiene, ni «sin propina» sobre nada guardado", () => {
    expect(
      hayQueGuardarPropina(
        PORCENTAJE(10),
        totales({ propinaPorcentaje: 10 }),
      ),
    ).toBe(false);
    expect(hayQueGuardarPropina(SIN_PROPINA, totales())).toBe(false);
  });

  it("quitar una propina guardada o cambiarla sí se guarda", () => {
    const guardada = totales({ propinaPorcentaje: 10 });
    expect(hayQueGuardarPropina(SIN_PROPINA, guardada)).toBe(true);
    expect(hayQueGuardarPropina(PORCENTAJE(15), guardada)).toBe(true);
    expect(hayQueGuardarPropina(MONTO(59), guardada)).toBe(true);
  });

  it("la etiqueta del desglose muestra el porcentaje solo si se eligió un porcentaje", () => {
    expect(etiquetaDePropina(PORCENTAJE(10))).toBe("Propina (10 %)");
    expect(etiquetaDePropina(MONTO(120))).toBe("Propina");
  });
});

describe("«Otro monto»", () => {
  it("vacío (o solo espacios) no es un error: todavía no escribió", () => {
    expect(evaluarMontoPropina("", 590)).toEqual({ tipo: "vacio" });
    expect(evaluarMontoPropina("   ", 590)).toEqual({ tipo: "vacio" });
  });

  it("solo pesos enteros desde $ 1: rechaza texto, centavos, cero y negativos", () => {
    for (const texto of ["abc", "12.5", "12,5", "0", "00", "-5", "123456789"]) {
      expect(evaluarMontoPropina(texto, 590)).toEqual({ tipo: "invalido" });
    }
  });

  it("no puede superar el consumo en pesos enteros; el tope exacto vale", () => {
    expect(evaluarMontoPropina("591", 590)).toEqual({
      tipo: "excede",
      tope: 590,
    });
    expect(evaluarMontoPropina("590", 590)).toEqual({ tipo: "ok", monto: 590 });
    // Consumo $ 590,50: el tope es $ 590.
    expect(evaluarMontoPropina("591", "590.50")).toEqual({
      tipo: "excede",
      tope: 590,
    });
    expect(evaluarMontoPropina("590", "590.50")).toEqual({
      tipo: "ok",
      monto: 590,
    });
  });

  it("ignora los espacios (1 000)", () => {
    expect(evaluarMontoPropina("1 000", 2000)).toEqual({
      tipo: "ok",
      monto: 1000,
    });
  });

  it("los mensajes: monto inválido, monto de más con el tope, y nada si está vacío o bien", () => {
    expect(errorMontoPropina({ tipo: "invalido" })).toBe(
      MENSAJE_MONTO_PROPINA_INVALIDO,
    );
    const excede = errorMontoPropina({ tipo: "excede", tope: 590 });
    expect(excede).toMatch(/La propina no puede superar el consumo/);
    expect(excede).toContain("590");
    expect(errorMontoPropina({ tipo: "vacio" })).toBeNull();
    expect(errorMontoPropina({ tipo: "ok", monto: 100 })).toBeNull();
  });
});

describe("errores al guardar la propina", () => {
  it("400, 409 y 410 muestran el motivo que redacta el backend", () => {
    for (const status of [400, 409, 410]) {
      expect(mensajeErrorPropina(status, "Motivo del backend")).toBe(
        "Motivo del backend",
      );
    }
  });

  it("sin motivo del backend, el mensaje genérico", () => {
    expect(mensajeErrorPropina(409)).toBe(MENSAJE_ERROR_PROPINA);
    expect(mensajeErrorPropina(500, "algo interno")).toBe(
      MENSAJE_ERROR_PROPINA,
    );
  });

  it("401, 403 y 404: no se pudo validar el pedido", () => {
    for (const status of [401, 403, 404]) {
      expect(mensajeErrorPropina(status, "x")).toBe(MENSAJE_SIN_ACCESO);
    }
  });
});
