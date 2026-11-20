import {
  anuncioDelEstado,
  anuncioVisible,
  botonDeshabilitado,
  hastaDespuesDe429,
  LIMITE_LLAMADO_MS,
  MENSAJE_AVISADO,
  MENSAJE_ERROR_LLAMADO,
  MENSAJE_YA_AVISADO,
  textoBoton,
  type EstadoLlamado,
} from "@/components/llamar-mozo.utils";

// BL-592: «Llamar al mozo» en la barra superior, con estados accesibles.
// El límite de 1 llamado por minuto (BL-70) es interno: no se muestra
// ningún tiempo al comensal.

describe("límite de 1 llamado por minuto", () => {
  it("después de un 429 usa Retry-After si llega y es válido", () => {
    expect(hastaDespuesDe429("30", 1_000)).toBe(31_000);
  });

  it("Retry-After nunca alarga la espera más allá del límite", () => {
    expect(hastaDespuesDe429("600", 0)).toBe(LIMITE_LLAMADO_MS);
  });

  it.each([[null], [""], ["abc"], ["0"], ["-5"]])(
    "sin Retry-After válido (%p) espera el límite completo",
    (header) => {
      expect(hastaDespuesDe429(header, 1_000)).toBe(1_000 + LIMITE_LLAMADO_MS);
    },
  );
});

describe("estados del botón", () => {
  it.each<[EstadoLlamado, boolean]>([
    ["listo", false],
    ["enviando", true],
    ["avisado", true],
    ["esperando", true],
    ["error", false],
  ])("%s: deshabilitado = %s", (estado, deshabilitado) => {
    expect(botonDeshabilitado(estado)).toBe(deshabilitado);
  });

  it("solo el error se ve en pantalla; avisado y 429 van solo al lector", () => {
    expect(anuncioVisible("error")).toBe(true);
    expect(anuncioVisible("avisado")).toBe(false);
    expect(anuncioVisible("esperando")).toBe(false);
    expect(anuncioVisible("listo")).toBe(false);
  });
});

describe("texto del botón", () => {
  it("primera vez: «Llamar al mozo»; en pantalla chica, «Mozo»", () => {
    expect(textoBoton("listo", false)).toEqual({
      etiqueta: "Llamar al mozo",
      visible: "Llamar al mozo",
    });
    expect(textoBoton("listo", false, true)).toEqual({
      etiqueta: "Llamar al mozo",
      visible: "Mozo",
    });
  });

  it("pasado el límite después de llamar: «Volver a llamar»", () => {
    expect(textoBoton("listo", true)).toEqual({
      etiqueta: "Volver a llamar al mozo",
      visible: "Volver a llamar",
    });
    expect(textoBoton("listo", true, true).visible).toBe("Mozo");
  });

  it("avisado y 429 se ven igual: el mozo ya sabe, sin tiempos", () => {
    expect(textoBoton("avisado", true)).toEqual({
      etiqueta: "Mozo avisado",
      visible: "Mozo avisado",
    });
    expect(textoBoton("esperando", true)).toEqual(textoBoton("avisado", true));
    expect(textoBoton("avisado", true, true).visible).toBe("Avisado");
  });

  it("enviando y error", () => {
    expect(textoBoton("enviando", false).visible).toBe("Avisando…");
    expect(textoBoton("error", false).visible).toBe("Reintentar");
  });

  it.each<[EstadoLlamado, boolean, boolean]>([
    ["listo", false, false],
    ["listo", false, true],
    ["listo", true, false],
    ["listo", true, true],
    ["enviando", false, false],
    ["avisado", true, false],
    ["avisado", true, true],
    ["esperando", true, true],
    ["error", false, false],
  ])(
    "WCAG 2.5.3: el nombre accesible contiene el texto visible (%s, ya llamó %s, compacto %s)",
    (estado, yaLlamo, compacto) => {
      const { etiqueta, visible } = textoBoton(estado, yaLlamo, compacto);
      expect(etiqueta.toLowerCase()).toContain(visible.toLowerCase());
    },
  );
});

describe("anuncio para el lector de pantalla", () => {
  it("avisado: confirma que el mozo ya sabe", () => {
    expect(anuncioDelEstado("avisado")).toBe(MENSAJE_AVISADO);
  });

  it("429: sin tono de error y sin tiempos", () => {
    expect(anuncioDelEstado("esperando")).toBe(MENSAJE_YA_AVISADO);
    expect(MENSAJE_YA_AVISADO).not.toMatch(/\d/);
  });

  it("error: el mensaje del backend o uno genérico", () => {
    expect(anuncioDelEstado("error", "Esta mesa está cerrada.")).toBe(
      "Esta mesa está cerrada.",
    );
    expect(anuncioDelEstado("error")).toBe(MENSAJE_ERROR_LLAMADO);
    expect(anuncioDelEstado("error", null)).toBe(MENSAJE_ERROR_LLAMADO);
  });

  it("listo y enviando: sin anuncio", () => {
    expect(anuncioDelEstado("listo")).toBeNull();
    expect(anuncioDelEstado("enviando")).toBeNull();
  });
});
