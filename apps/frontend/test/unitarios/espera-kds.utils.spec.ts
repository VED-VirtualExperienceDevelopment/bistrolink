import {
  ETIQUETA_NIVEL_ESPERA,
  UMBRALES_ESPERA_POR_DEFECTO,
  minutosDeEspera,
  nivelDeEspera,
  textoEspera,
} from "@/components/kds/espera-kds.utils";

// HU-038 (BL-208): tiempo de espera y nivel de color de las comandas del KDS.

const LLEGADA = "2026-11-09T12:00:00.000Z";
const LLEGADA_MS = new Date(LLEGADA).getTime();
const minutosDespues = (m: number, segundos = 0) =>
  LLEGADA_MS + m * 60_000 + segundos * 1000;

describe("minutosDeEspera", () => {
  it("cuenta minutos enteros desde la llegada", () => {
    expect(minutosDeEspera(LLEGADA, minutosDespues(0))).toBe(0);
    expect(minutosDeEspera(LLEGADA, minutosDespues(0, 59))).toBe(0);
    expect(minutosDeEspera(LLEGADA, minutosDespues(1))).toBe(1);
    expect(minutosDeEspera(LLEGADA, minutosDespues(45, 30))).toBe(45);
  });

  it("no da negativo si el reloj del tablero quedó atrás del pedido", () => {
    expect(minutosDeEspera(LLEGADA, LLEGADA_MS - 20_000)).toBe(0);
  });

  it("da 0 con una fecha inválida", () => {
    expect(minutosDeEspera("no-es-fecha", minutosDespues(10))).toBe(0);
  });
});

describe("nivelDeEspera con los umbrales por defecto (30/60/120)", () => {
  it.each([
    [0, "a-tiempo"],
    [29, "a-tiempo"],
    [30, "atencion"],
    [59, "atencion"],
    [60, "demorado"],
    [119, "demorado"],
    [120, "demora-alta"],
    [300, "demora-alta"],
  ])("%i min → %s", (minutos, esperado) => {
    expect(nivelDeEspera(minutos)).toBe(esperado);
  });

  it("los valores por defecto son 30, 60 y 120", () => {
    expect(UMBRALES_ESPERA_POR_DEFECTO).toEqual({
      atencion: 30,
      demorado: 60,
      demoraAlta: 120,
    });
  });
});

describe("nivelDeEspera con umbrales del local", () => {
  const umbrales = { atencion: 10, demorado: 20, demoraAlta: 40 };

  it("usa los umbrales que recibe en lugar de los por defecto", () => {
    expect(nivelDeEspera(9, umbrales)).toBe("a-tiempo");
    expect(nivelDeEspera(10, umbrales)).toBe("atencion");
    expect(nivelDeEspera(20, umbrales)).toBe("demorado");
    expect(nivelDeEspera(40, umbrales)).toBe("demora-alta");
  });
});

describe("el nivel cambia solo con el paso del tiempo", () => {
  it("el mismo pedido pasa de «A tiempo» a «Atención» sin otro evento", () => {
    const antes = nivelDeEspera(
      minutosDeEspera(LLEGADA, minutosDespues(29, 50)),
    );
    const despues = nivelDeEspera(
      minutosDeEspera(LLEGADA, minutosDespues(30, 20)),
    );
    expect(antes).toBe("a-tiempo");
    expect(despues).toBe("atencion");
  });
});

describe("textoEspera", () => {
  it.each([
    [0, "Recién llegado"],
    [1, "hace 1 min"],
    [59, "hace 59 min"],
    [60, "hace 1 h"],
    [65, "hace 1 h 5 min"],
    [120, "hace 2 h"],
    [135, "hace 2 h 15 min"],
  ])("%i min → «%s»", (minutos, esperado) => {
    expect(textoEspera(minutos)).toBe(esperado);
  });
});

describe("ETIQUETA_NIVEL_ESPERA", () => {
  it("cada nivel tiene su texto (no solo color)", () => {
    expect(ETIQUETA_NIVEL_ESPERA).toEqual({
      "a-tiempo": "A tiempo",
      atencion: "Atención",
      demorado: "Demorado",
      "demora-alta": "Demora alta",
    });
  });
});
