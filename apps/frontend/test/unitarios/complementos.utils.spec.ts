import {
  ESTADO_INICIAL_SUGERENCIA,
  explicacionComplementos,
  idsDelPedido,
  MAXIMO_SUGERENCIAS,
  respuestaDeComplementos,
  rutaComplementos,
  siguienteEstadoSugerencia,
  sugerenciasVisibles,
  type AccionSugerencia,
  type EstadoSugerencia,
  type RespuestaComplementos,
} from "@/components/carrito/complementos.utils";

/** HU-046 (BL-553): sugerencia de complementos en el detalle del pedido. */

const plato = (id: string) => ({
  id,
  nombre: `Plato ${id}`,
  descripcion: null,
  precio: "180",
  imagenUrl: null,
});
const RESPUESTA: RespuestaComplementos = {
  origen: "reglas",
  sugerencias: [plato("flan"), plato("agua"), plato("cafe")],
};
const linea = (itemCartaId: string) => ({ itemCartaId });

const aplicar = (...acciones: AccionSugerencia[]): EstadoSugerencia =>
  acciones.reduce(siguienteEstadoSugerencia, ESTADO_INICIAL_SUGERENCIA);

describe("HU-046 (BL-553): una vez por pedido", () => {
  it("se pide una vez y muestra la respuesta", () => {
    const estado = aplicar(
      { tipo: "pedir" },
      { tipo: "recibir", pedido: 0, respuesta: RESPUESTA },
    );
    expect(estado).toEqual({ fase: "pedida", pedido: 0, respuesta: RESPUESTA });
    // Pedir otra vez no cambia nada (no se vuelve a consultar).
    expect(siguienteEstadoSugerencia(estado, { tipo: "pedir" })).toBe(estado);
  });

  it("agregar o rechazar la resuelve: no vuelve a aparecer en ese pedido", () => {
    const resuelta = aplicar(
      { tipo: "pedir" },
      { tipo: "recibir", pedido: 0, respuesta: RESPUESTA },
      { tipo: "resolver" },
    );
    expect(resuelta.fase).toBe("resuelta");
    expect(sugerenciasVisibles(resuelta, [linea("milanesa")])).toEqual([]);
    // Cerrar y abrir la hoja vuelve a «pedir»: no pasa nada.
    expect(siguienteEstadoSugerencia(resuelta, { tipo: "pedir" })).toBe(
      resuelta,
    );
  });

  it("con el carrito vacío (o el pago aprobado) se reinicia para el próximo pedido", () => {
    const reiniciada = aplicar(
      { tipo: "pedir" },
      { tipo: "recibir", pedido: 0, respuesta: RESPUESTA },
      { tipo: "resolver" },
      { tipo: "reiniciar" },
    );
    expect(reiniciada).toEqual({
      fase: "pendiente",
      pedido: 1,
      respuesta: null,
    });
    // Reiniciar sin haber pedido nada no cambia el estado.
    expect(
      siguienteEstadoSugerencia(ESTADO_INICIAL_SUGERENCIA, {
        tipo: "reiniciar",
      }),
    ).toBe(ESTADO_INICIAL_SUGERENCIA);
  });

  it("una respuesta que llega tarde, de un pedido anterior o ya resuelto, se descarta", () => {
    const nuevoPedido = aplicar(
      { tipo: "pedir" },
      { tipo: "reiniciar" },
      { tipo: "pedir" },
    );
    expect(
      siguienteEstadoSugerencia(nuevoPedido, {
        tipo: "recibir",
        pedido: 0,
        respuesta: RESPUESTA,
      }).respuesta,
    ).toBeNull();
    const resuelta = aplicar({ tipo: "pedir" }, { tipo: "resolver" });
    expect(
      siguienteEstadoSugerencia(resuelta, {
        tipo: "recibir",
        pedido: 0,
        respuesta: RESPUESTA,
      }),
    ).toBe(resuelta);
  });
});

describe("sugerenciasVisibles", () => {
  const pedida = aplicar(
    { tipo: "pedir" },
    { tipo: "recibir", pedido: 0, respuesta: RESPUESTA },
  );

  it("hasta 2 platos y sin los que ya están en el pedido", () => {
    expect(MAXIMO_SUGERENCIAS).toBe(2);
    expect(
      sugerenciasVisibles(pedida, [linea("milanesa")]).map((p) => p.id),
    ).toEqual(["flan", "agua"]);
    // El comensal agregó el flan desde la carta: se muestran los otros.
    expect(
      sugerenciasVisibles(pedida, [linea("milanesa"), linea("flan")]).map(
        (p) => p.id,
      ),
    ).toEqual(["agua", "cafe"]);
  });

  it("sin respuesta (todavía, o si la API falló) no muestra nada", () => {
    expect(sugerenciasVisibles(ESTADO_INICIAL_SUGERENCIA, [])).toEqual([]);
    expect(
      sugerenciasVisibles(aplicar({ tipo: "pedir" }), [linea("a")]),
    ).toEqual([]);
  });
});

describe("rutaComplementos", () => {
  it("por QR (con el token codificado), por enlace web, y nada con el link de pago", () => {
    expect(
      rutaComplementos({ tipo: "mesa", qrToken: "a/b+c", sesionMesa: "s" }),
    ).toBe("/menu/qr/a%2Fb%2Bc/complementos");
    expect(
      rutaComplementos({ tipo: "publico", tenantId: "t", restauranteId: "r" }),
    ).toBe("/menu/tenant/t/restaurante/r/complementos");
    expect(rutaComplementos({ tipo: "link", linkToken: "x" })).toBeNull();
  });
});

describe("respuestaDeComplementos", () => {
  it("toma solo los platos con la forma esperada", () => {
    expect(
      respuestaDeComplementos({
        origen: "popularidad",
        sugerencias: [
          { id: "flan", nombre: "Flan", precio: "180" },
          { id: 1, nombre: "Mal" },
          null,
        ],
      }),
    ).toEqual({
      origen: "popularidad",
      sugerencias: [
        {
          id: "flan",
          nombre: "Flan",
          descripcion: null,
          precio: "180",
          imagenUrl: null,
        },
      ],
    });
  });

  it.each([
    [null],
    ["texto"],
    [{ origen: "otro", sugerencias: [] }],
    [{ origen: "reglas" }],
  ])("una respuesta inesperada (%p) no muestra nada", (cuerpo) => {
    expect(respuestaDeComplementos(cuerpo)).toBeNull();
  });
});

describe("textos", () => {
  it("explica de dónde sale la sugerencia", () => {
    expect(explicacionComplementos("reglas")).toBe(
      "Suele pedirse junto con lo que elegiste",
    );
    expect(explicacionComplementos("popularidad")).toBe(
      "Es de lo más pedido del local",
    );
  });

  it("los ids del pedido, sin repetir", () => {
    expect(idsDelPedido([linea("a"), linea("b"), linea("a")])).toEqual([
      "a",
      "b",
    ]);
  });
});
