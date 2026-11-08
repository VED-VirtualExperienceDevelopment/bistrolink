import {
  ANCLA_TACTIL,
  configuracionTactil,
  desfaseInputNumero,
  DISTANCIA_ANCLA_ROTACION_TACTIL,
  propsAnclasTransformer,
  textoEditarNumero,
  ZONA_TOQUE_EXTRA_TACTIL,
} from "@/components/admin/mesas/mapa-mesas.utils";

// Editor del plano con el dedo (tablet y celular): anclas del Transformer y
// zona de toque de las mesas. Konva no ve las clases touch: de Tailwind, así
// que estos valores se pasan por props.

describe("configuracionTactil", () => {
  it("con mouse no pisa los valores por defecto de Konva", () => {
    expect(configuracionTactil(false)).toEqual({ zonaToqueMesa: "auto" });
  });

  it("con el dedo agranda las anclas y las zonas de toque", () => {
    expect(configuracionTactil(true)).toEqual({
      anchorSize: ANCLA_TACTIL,
      rotateAnchorOffset: DISTANCIA_ANCLA_ROTACION_TACTIL,
      zonaToqueAncla: ZONA_TOQUE_EXTRA_TACTIL,
      zonaToqueMesa: ZONA_TOQUE_EXTRA_TACTIL,
    });
  });

  it("el ancla más su borde invisible llegan a 48 px de zona táctil", () => {
    expect(ANCLA_TACTIL + ZONA_TOQUE_EXTRA_TACTIL).toBeGreaterThanOrEqual(48);
  });

  it("el ancla de rotación queda separada del recuadro más que su tamaño", () => {
    // Si quedara más cerca, el ancla de rotación se superpone con las de las
    // esquinas y un toque podría agarrar la equivocada.
    expect(DISTANCIA_ANCLA_ROTACION_TACTIL).toBeGreaterThan(ANCLA_TACTIL);
  });
});

describe("propsAnclasTransformer", () => {
  it("con mouse no pasa nada y Konva usa sus valores por defecto", () => {
    expect(propsAnclasTransformer(configuracionTactil(false))).toEqual({});
  });

  it("con el dedo agranda las anclas y suma el borde invisible de toque", () => {
    const props = propsAnclasTransformer(configuracionTactil(true));
    expect(props.anchorSize).toBe(ANCLA_TACTIL);
    expect(props.rotateAnchorOffset).toBe(DISTANCIA_ANCLA_ROTACION_TACTIL);
    const ancla = { hitStrokeWidth: jest.fn() };
    props.anchorStyleFunc?.(ancla as never);
    expect(ancla.hitStrokeWidth).toHaveBeenCalledWith(ZONA_TOQUE_EXTRA_TACTIL);
  });
});

describe("textoEditarNumero", () => {
  it("dice toque con el dedo y clic con mouse", () => {
    expect(textoEditarNumero(true)).toBe(
      "Doble toque en la mesa para cambiar su número.",
    );
    expect(textoEditarNumero(false)).toBe(
      "Doble clic en la mesa para cambiar su número.",
    );
  });
});

describe("desfaseInputNumero", () => {
  it("centra el campo del número: la mitad de su ancho y de su alto", () => {
    // Con el dedo el campo mide 80 × 48 px (touch:w-20 touch:h-12).
    expect(desfaseInputNumero(true)).toEqual({ x: 40, y: 24 });
    expect(desfaseInputNumero(false)).toEqual({ x: 28, y: 14 });
  });
});
