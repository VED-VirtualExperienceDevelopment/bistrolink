import {
  etiquetaEstadoConCola,
  lugarVigente,
  separarPorCola,
  textoAltaDemanda,
  textoContadorCola,
  textoEnCola,
  type EstadoCola,
} from "@/components/kds/cola-kds.utils";
import type { Pedido } from "@/types/pedido";

// HU-042 (BL-466): cola de pedidos en el KDS y en el seguimiento del comensal.

function pedido(id: string, estado: Pedido["estado"], minuto: number): Pedido {
  return {
    id,
    mesaNumero: 1,
    estado,
    createdAt: `2026-11-06T12:${String(minuto).padStart(2, "0")}:00.000Z`,
    lineas: [],
  };
}

const COLA: EstadoCola = {
  activa: true,
  limite: 5,
  enPreparacion: 5,
  enEspera: 2,
  umbralAlerta: 10,
  altaDemanda: false,
  minutosEstimados: 24,
  orden: [
    { pedidoId: "B", posicion: 1, minutosEstimados: 18 },
    { pedidoId: "A", posicion: 2, minutosEstimados: 21 },
  ],
};

describe("separarPorCola", () => {
  const pedidos = [
    pedido("A", "RECIBIDO", 1),
    pedido("B", "RECIBIDO", 2),
    pedido("C", "EN_PREPARACION", 0),
    pedido("D", "LISTO_PARA_ENTREGAR", 0),
  ];

  it("[TC-U-412] sin cola activa, el tablero queda como siempre", () => {
    expect(separarPorCola(pedidos, null)).toEqual({
      enEspera: [],
      activos: pedidos,
    });
  });

  it("[TC-U-413] con la cola activa, los RECIBIDO van a «En espera» en el orden de la cola (FIFO del servidor)", () => {
    const { enEspera, activos } = separarPorCola(pedidos, COLA);

    // B llegó después a crearse pero antes a la cola: manda el servidor.
    expect(enEspera.map(({ pedido: p, posicion }) => [p.id, posicion])).toEqual(
      [
        ["B", 1],
        ["A", 2],
      ],
    );
    expect(activos.map((p) => p.id)).toEqual(["C", "D"]);
  });

  it("[TC-U-414] un pedido en espera que todavía no está en el orden va al final, sin número", () => {
    const { enEspera } = separarPorCola(
      [...pedidos, pedido("E", "RECIBIDO", 0)],
      COLA,
    );

    expect(enEspera.map(({ pedido: p, posicion }) => [p.id, posicion])).toEqual(
      [
        ["B", 1],
        ["A", 2],
        ["E", null],
      ],
    );
  });
});

describe("textos de la cola", () => {
  it("[TC-U-415] contador y alta demanda con texto (no solo color)", () => {
    expect(textoContadorCola(COLA)).toBe("En preparación 5 de 5 · En espera 2");
    expect(textoAltaDemanda({ ...COLA, enEspera: 12, altaDemanda: true })).toBe(
      "Alta demanda: 12 pedidos en espera (más de 10). Los nuevos esperan unos 24 min.",
    );
  });

  it("[TC-U-416] con la cola activa, RECIBIDO se muestra «En espera»; sin cola, la etiqueta de siempre", () => {
    expect(etiquetaEstadoConCola("RECIBIDO", "Recibido", true)).toBe(
      "En espera",
    );
    expect(etiquetaEstadoConCola("RECIBIDO", "Recibido", false)).toBe(
      "Recibido",
    );
    expect(
      etiquetaEstadoConCola("EN_PREPARACION", "En preparación", true),
    ).toBe("En preparación");
  });

  it("[TC-U-417] comensal: «En cola» con posición y tiempo, solo mientras el pedido espera", () => {
    const lugar = { pedidoId: "A", posicion: 2, minutosEstimados: 21 };

    expect(textoEnCola(lugar)).toBe("En cola · posición 2 · unos 21 min");
    expect(lugarVigente("RECIBIDO", lugar)).toBe(lugar);
    expect(lugarVigente("EN_PREPARACION", lugar)).toBeNull();
    expect(lugarVigente("RECIBIDO", null)).toBeNull();
  });
});
