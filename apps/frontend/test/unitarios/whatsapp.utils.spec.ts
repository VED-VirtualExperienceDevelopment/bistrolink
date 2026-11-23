import {
  enlacePedirPorWhatsapp,
  errorNumeroWhatsapp,
  normalizarNumeroWhatsapp,
  ofrecerPedirPorWhatsapp,
} from "@/components/retiro/whatsapp.utils";

// HU-010 (BL-613): número del bot de WhatsApp y enlace del menú para retirar.

const ABIERTO = {
  habilitado: true,
  abierto: true,
  horaDesde: null,
  horaHasta: null,
};

describe("número del bot de WhatsApp (BL-613)", () => {
  it("[TC-U-693] lo pasa a formato internacional como lo escriba el administrador (igual que el backend) y marca lo que no se puede leer", () => {
    expect(normalizarNumeroWhatsapp("099 123 456")).toBe("+59899123456");
    expect(normalizarNumeroWhatsapp("(099) 123-456")).toBe("+59899123456");
    expect(normalizarNumeroWhatsapp("598 99 123 456")).toBe("+59899123456");
    expect(normalizarNumeroWhatsapp("+54 9 11 1234-5678")).toBe(
      "+5491112345678",
    );
    expect(normalizarNumeroWhatsapp("  ")).toBeNull();

    expect(errorNumeroWhatsapp("")).toBeNull();
    expect(errorNumeroWhatsapp("099 123 456")).toBeNull();
    expect(errorNumeroWhatsapp("+34 612 345 678")).toBeNull();
    for (const mal of ["2900 1234", "12345678", "+0598991234", "hola"]) {
      expect(errorNumeroWhatsapp(mal)).toMatch(/celular uruguayo/);
    }
  });

  it("[TC-U-694] el enlace abre el chat con el bot y «Hola» escrito", () => {
    expect(enlacePedirPorWhatsapp("59899123456")).toBe(
      "https://wa.me/59899123456?text=Hola",
    );
    expect(enlacePedirPorWhatsapp("+59899123456")).toBe(
      "https://wa.me/59899123456?text=Hola",
    );
  });

  it("[TC-U-695] se ofrece solo en el menú para retirar, con número y con el local tomando pedidos", () => {
    expect(ofrecerPedirPorWhatsapp("publico", "59899123456", ABIERTO)).toBe(
      true,
    );
    // Un backend anterior no manda el retiro: se puede pedir, como antes.
    expect(ofrecerPedirPorWhatsapp("publico", "59899123456", undefined)).toBe(
      true,
    );
    // Nunca en la mesa ni en el link de pago.
    expect(ofrecerPedirPorWhatsapp("mesa", "59899123456", ABIERTO)).toBe(false);
    expect(ofrecerPedirPorWhatsapp("link", "59899123456", ABIERTO)).toBe(false);
    // Sin número (o el bot no atiende al local): no.
    expect(ofrecerPedirPorWhatsapp("publico", null, ABIERTO)).toBe(false);
    expect(ofrecerPedirPorWhatsapp("publico", undefined, ABIERTO)).toBe(false);
    // Fuera de horario o con el retiro apagado: tampoco.
    expect(
      ofrecerPedirPorWhatsapp("publico", "59899123456", {
        ...ABIERTO,
        abierto: false,
      }),
    ).toBe(false);
  });
});
