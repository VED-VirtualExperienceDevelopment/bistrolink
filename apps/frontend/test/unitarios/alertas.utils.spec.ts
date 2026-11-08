import { formatearMonto } from "@/components/admin/cobros/cobros.utils";
import type { LlamadoMozo } from "@/components/kds/llamado.utils";
import {
  UMBRAL_DEMORA_MS,
  agregarLlamadoConservandoEspera,
  detalleEfectivo,
  esDemorada,
  etiquetaCampana,
  ordenarLlamados,
  textoContador,
  tiempoTranscurrido,
  tituloAlerta,
} from "@/components/alertas/alertas.utils";

// BL-441: campana y panel de alertas del mozo.

const atencion: LlamadoMozo = { mesaId: "m1", mesaNumero: 5, ts: 2000 };
const efectivo: LlamadoMozo = {
  mesaId: "m2",
  mesaNumero: 3,
  ts: 1000,
  motivo: "PAGO_EFECTIVO",
  pedidoId: "p1",
  total: "1220.00",
  pagaCon: "1500.00",
};

describe("ordenarLlamados", () => {
  it("deja primero la alerta más antigua", () => {
    expect(ordenarLlamados([atencion, efectivo])).toEqual([efectivo, atencion]);
  });

  it("no modifica el arreglo original", () => {
    const original = [atencion, efectivo];
    ordenarLlamados(original);
    expect(original).toEqual([atencion, efectivo]);
  });
});

describe("agregarLlamadoConservandoEspera", () => {
  it("agrega tal cual la alerta de una mesa nueva", () => {
    expect(agregarLlamadoConservandoEspera([atencion], efectivo)).toEqual([
      atencion,
      efectivo,
    ]);
  });

  it("si la mesa vuelve a llamar, conserva la hora del primer llamado", () => {
    const repetido = { ...atencion, ts: 9000 };
    expect(agregarLlamadoConservandoEspera([atencion], repetido)).toEqual([
      { ...atencion, ts: 2000 },
    ]);
  });

  it("una mesa que insiste sigue arriba de la lista", () => {
    const resultado = ordenarLlamados(
      agregarLlamadoConservandoEspera([efectivo, atencion], {
        ...efectivo,
        ts: 9000,
      }),
    );
    expect(resultado.map((l) => l.mesaId)).toEqual(["m2", "m1"]);
  });

  it("si cambia el motivo, toma el dato nuevo pero conserva la espera", () => {
    const aEfectivo: LlamadoMozo = {
      ...efectivo,
      mesaId: "m1",
      mesaNumero: 5,
      ts: 9000,
    };
    expect(agregarLlamadoConservandoEspera([atencion], aEfectivo)).toEqual([
      { ...aEfectivo, ts: 2000 },
    ]);
  });

  it("no modifica el arreglo original", () => {
    const original = [atencion];
    agregarLlamadoConservandoEspera(original, { ...atencion, ts: 9000 });
    expect(original).toEqual([atencion]);
  });
});

describe("tiempoTranscurrido", () => {
  it("muestra segundos por debajo del minuto", () => {
    expect(tiempoTranscurrido(0, 5_000)).toBe("hace 5 s");
  });

  it("muestra minutos", () => {
    expect(tiempoTranscurrido(0, 3 * 60_000 + 20_000)).toBe("hace 3 min");
  });

  it("muestra horas", () => {
    expect(tiempoTranscurrido(0, 2 * 3_600_000)).toBe("hace 2 h");
  });

  it("no da negativos si el reloj del servidor va adelantado", () => {
    expect(tiempoTranscurrido(10_000, 5_000)).toBe("hace 0 s");
  });
});

describe("esDemorada", () => {
  it("no es demorada antes del umbral", () => {
    expect(esDemorada(0, UMBRAL_DEMORA_MS - 1)).toBe(false);
  });

  it("es demorada desde el umbral", () => {
    expect(esDemorada(0, UMBRAL_DEMORA_MS)).toBe(true);
  });

  it("acepta otro umbral", () => {
    expect(esDemorada(0, 10_000, 5_000)).toBe(true);
    expect(esDemorada(0, 4_000, 5_000)).toBe(false);
  });
});

describe("textoContador", () => {
  it("no muestra nada sin alertas", () => {
    expect(textoContador(0)).toBe("");
  });

  it("muestra el número hasta 9", () => {
    expect(textoContador(1)).toBe("1");
    expect(textoContador(9)).toBe("9");
  });

  it("muestra 9+ desde 10", () => {
    expect(textoContador(10)).toBe("9+");
    expect(textoContador(25)).toBe("9+");
  });
});

describe("etiquetaCampana", () => {
  it("avisa que no hay pendientes", () => {
    expect(etiquetaCampana(0)).toBe("Alertas, sin pendientes");
  });

  it("usa singular y plural", () => {
    expect(etiquetaCampana(1)).toBe("Alertas, 1 pendiente");
    expect(etiquetaCampana(4)).toBe("Alertas, 4 pendientes");
  });
});

describe("tituloAlerta y detalleEfectivo", () => {
  it("titula la solicitud de atención", () => {
    expect(tituloAlerta(atencion)).toBe("Mesa 5 solicita atención");
    expect(detalleEfectivo(atencion)).toBeNull();
  });

  it("titula el pago en efectivo y muestra total y con cuánto paga", () => {
    expect(tituloAlerta(efectivo)).toBe("Mesa 3 quiere pagar en efectivo");
    expect(detalleEfectivo(efectivo)).toBe(
      `Total ${formatearMonto("1220.00")} · paga con ${formatearMonto("1500.00")}`,
    );
  });

  it("omite 'paga con' si el comensal no lo indicó", () => {
    expect(detalleEfectivo({ ...efectivo, pagaCon: null })).toBe(
      `Total ${formatearMonto("1220.00")}`,
    );
  });
});
