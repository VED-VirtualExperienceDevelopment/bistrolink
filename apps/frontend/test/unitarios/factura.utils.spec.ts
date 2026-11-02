import {
  erroresFactura,
  FACTURA_VACIA,
  facturaBloqueaElPago,
  facturaSinConsentimiento,
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
    expect(facturaSinConsentimiento(FACTURA_VACIA)).toBe(false);
  });

  it("datos válidos con el aviso aceptado: manda RUT y razón social normalizados", () => {
    expect(erroresFactura(completo)).toEqual({});
    expect(receptorParaEnviar(completo)).toEqual({
      rut: RUT,
      razonSocial: "Comensal Ejemplo SAS",
      consentimiento: true,
    });
  });

  it("sin aceptar el aviso: no bloquea el pago, no manda los datos y avisa que recibe un e-Ticket", () => {
    const sinAviso = { ...completo, rut: "123", consentimiento: false };
    expect(erroresFactura(sinAviso)).toEqual({});
    expect(facturaBloqueaElPago(sinAviso)).toBe(false);
    expect(receptorParaEnviar(sinAviso)).toBeNull();
    expect(facturaSinConsentimiento(sinAviso)).toBe(true);
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
