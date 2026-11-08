import {
  cuerpoDeCancelacion,
  errorDelFormulario,
  instruccionDeDevolucion,
  MOTIVOS_CANCELACION,
  nombreDelMedio,
  requiereDevolucionManual,
  rutaCancelacion,
  sePuedeCancelar,
  type DevolucionDelPago,
  type FormularioCancelacion,
} from "@/components/kds/cancelacion.utils";
import { nombreDelComprobante } from "@/components/pago/factura.utils";

// HU-024 (BL-104): cancelación de un pedido pagado desde el KDS.

const MP: DevolucionDelPago = {
  pagoId: "p-1",
  medio: "MERCADOPAGO",
  monto: "590.00",
  automatica: true,
};
const EFECTIVO: DevolucionDelPago = {
  pagoId: "p-2",
  medio: "EFECTIVO",
  monto: "590.00",
  automatica: false,
};
const POS: DevolucionDelPago = {
  pagoId: "p-3",
  medio: "POS_DEBITO",
  monto: "590.00",
  automatica: false,
};
const LLENO: FormularioCancelacion = {
  motivo: "RECLAMO_CLIENTE",
  detalle: "",
  devolucionConfirmada: false,
};

describe("cancelacion.utils (HU-024, BL-104)", () => {
  it("ruta y estados cancelables: recibido o en preparación", () => {
    expect(rutaCancelacion("a b")).toBe("/pedidos/a%20b/cancelacion");
    expect(sePuedeCancelar("RECIBIDO")).toBe(true);
    expect(sePuedeCancelar("EN_PREPARACION")).toBe(true);
    for (const estado of [
      "LISTO_PARA_ENTREGAR",
      "ENTREGADO",
      "CANCELADO",
      "PENDIENTE_PAGO",
    ]) {
      expect(sePuedeCancelar(estado)).toBe(false);
    }
  });

  it("los cinco motivos del backend, con «Otro» al final", () => {
    expect(MOTIVOS_CANCELACION.map((m) => m.codigo)).toEqual([
      "ERROR_PEDIDO",
      "RECLAMO_CLIENTE",
      "PRODUCTO_NO_DISPONIBLE",
      "COBRO_DUPLICADO",
      "OTRO",
    ]);
  });

  it("qué hace el mozo con cada pago: Mercado Pago solo; efectivo y POS a mano", () => {
    expect(instruccionDeDevolucion(MP)).toBe(
      "Se reembolsa por Mercado Pago automáticamente.",
    );
    expect(instruccionDeDevolucion(EFECTIVO)).toBe(
      "Devolvé el efectivo al comensal.",
    );
    expect(instruccionDeDevolucion(POS)).toBe(
      "Anulá el cobro en el POS del local.",
    );
    expect(nombreDelMedio("POS_CREDITO")).toBe("crédito (POS del local)");
    expect(nombreDelMedio("OTRO")).toBe("OTRO");
    expect(requiereDevolucionManual({ devoluciones: [MP] })).toBe(false);
    expect(requiereDevolucionManual({ devoluciones: [MP, POS] })).toBe(true);
  });

  it("validación: motivo obligatorio, detalle con «Otro» y hasta 200, y confirmación de la devolución manual", () => {
    const soloMp = { devoluciones: [MP] };
    expect(errorDelFormulario({ ...LLENO, motivo: "" }, soloMp)).toBe(
      "Elegí el motivo de la cancelación.",
    );
    expect(
      errorDelFormulario({ ...LLENO, motivo: "OTRO", detalle: "  " }, soloMp),
    ).toBe("Contá brevemente el motivo.");
    expect(
      errorDelFormulario({ ...LLENO, detalle: "x".repeat(201) }, soloMp),
    ).toContain("hasta 200");
    expect(errorDelFormulario(LLENO, soloMp)).toBeNull();
    expect(errorDelFormulario(LLENO, { devoluciones: [EFECTIVO] })).toBe(
      "Confirmá que hiciste la devolución.",
    );
    expect(
      errorDelFormulario(
        { ...LLENO, devolucionConfirmada: true },
        { devoluciones: [EFECTIVO] },
      ),
    ).toBeNull();
  });

  it("body: el detalle limpio y solo si se escribió", () => {
    expect(cuerpoDeCancelacion(LLENO)).toEqual({
      motivo: "RECLAMO_CLIENTE",
      devolucionManualConfirmada: false,
    });
    expect(
      cuerpoDeCancelacion({
        motivo: "OTRO",
        detalle: "  se fue   sin esperar ",
        devolucionConfirmada: true,
      }),
    ).toEqual({
      motivo: "OTRO",
      detalle: "se fue sin esperar",
      devolucionManualConfirmada: true,
    });
  });

  it("nombre de las notas de crédito", () => {
    expect(nombreDelComprobante("102")).toBe("Nota de crédito de e-Ticket");
    expect(nombreDelComprobante("112")).toBe("Nota de crédito de e-Factura");
    expect(nombreDelComprobante("111")).toBe("e-Factura");
    expect(nombreDelComprobante("101")).toBe("e-Ticket");
  });
});
