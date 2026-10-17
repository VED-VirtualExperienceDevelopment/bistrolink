import {
  ANCLA_TACTIL,
  configuracionTactil,
  DISTANCIA_ANCLA_ROTACION_TACTIL,
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
