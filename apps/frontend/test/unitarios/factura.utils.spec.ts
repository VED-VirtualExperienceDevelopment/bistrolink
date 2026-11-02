import {
  erroresFactura,
  FACTURA_VACIA,
  facturaBloqueaElPago,
  MENSAJE_FALTA_CONSENTIMIENTO,
  nombreDelComprobante,
  receptorParaEnviar,
  type FormularioFactura,
} from "@/components/pago/factura.utils";

// HU-009 (BL-453): e-Factura con RUT y razón social en la pantalla de pago.
// RUT de ejemplo con dígito verificador válido.
const RUT = "219999830019";

const completo: FormularioFactura = {
  quiere: true,
  rut: "21.999983.001-9",
  razonSocial: "  Comensal   Ejemplo SAS ",
  consentimiento: true,
};

describe("factura.utils (HU-009, BL-453)", () => {
  it("sin pedir e-Factura: nada que validar, no bloquea y manda null", () => {
    expect(erroresFactura(FACTURA_VACIA)).toEqual({});
    expect(facturaBloqueaElPago(FACTURA_VACIA)).toBe(false);
    expect(receptorParaEnviar(FACTURA_VACIA)).toBeNull();
  });

  it("datos válidos con el aviso aceptado: manda RUT y razón social normalizados", () => {
    expect(erroresFactura(completo)).toEqual({});
    expect(receptorParaEnviar(completo)).toEqual({
      rut: RUT,
      razonSocial: "Comensal Ejemplo SAS",
      consentimiento: true,
    });
  });

  it("cargó datos y no aceptó el aviso: bloquea el pago hasta aceptar, borrar los datos o desmarcar la e-Factura", () => {
    const sinAviso = { ...completo, consentimiento: false };
    expect(erroresFactura(sinAviso)).toEqual({
      consentimiento: MENSAJE_FALTA_CONSENTIMIENTO,
    });
    expect(facturaBloqueaElPago(sinAviso)).toBe(true);
    expect(receptorParaEnviar(sinAviso)).toBeNull();

    // Con un solo campo cargado también bloquea.
    expect(
      facturaBloqueaElPago({ ...sinAviso, rut: "", razonSocial: "Algo SA" }),
    ).toBe(true);

    // Borró los datos: es como no pedirla.
    const borrados = { ...sinAviso, rut: " ", razonSocial: "" };
    expect(facturaBloqueaElPago(borrados)).toBe(false);
    expect(receptorParaEnviar(borrados)).toBeNull();

    // Desmarcó la e-Factura: no bloquea aunque los datos sigan escritos.
    const desmarcada = { ...sinAviso, quiere: false };
    expect(facturaBloqueaElPago(desmarcada)).toBe(false);
    expect(receptorParaEnviar(desmarcada)).toBeNull();
  });

  it("el mensaje explica las tres salidas", () => {
    expect(MENSAJE_FALTA_CONSENTIMIENTO).toMatch(/aceptar/);
    expect(MENSAJE_FALTA_CONSENTIMIENTO).toMatch(
      /borrá el RUT y la razón social/,
    );
    expect(MENSAJE_FALTA_CONSENTIMIENTO).toMatch(/desmarcá/);
  });

  it("con el aviso aceptado y el RUT inválido: bloquea el pago y explica el error", () => {
    const malRut = { ...completo, rut: "219999830018" };
    expect(erroresFactura(malRut)).toEqual({
      rut: expect.stringMatching(/verificador/),
    });
    expect(facturaBloqueaElPago(malRut)).toBe(true);
    expect(receptorParaEnviar(malRut)).toBeNull();
  });

  it("con el aviso aceptado y sin razón social: bloquea el pago", () => {
    const sinRazon = { ...completo, razonSocial: "   " };
    expect(erroresFactura(sinRazon)).toEqual({
      razonSocial: expect.stringMatching(/razón social/),
    });
    expect(facturaBloqueaElPago(sinRazon)).toBe(true);
  });

  it("nombre del comprobante según el tipo de CFE", () => {
    expect(nombreDelComprobante("111")).toBe("e-Factura");
    expect(nombreDelComprobante("101")).toBe("e-Ticket");
    expect(nombreDelComprobante(undefined)).toBe("e-Ticket");
  });
});
