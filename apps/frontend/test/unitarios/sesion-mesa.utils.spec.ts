import {
  DETALLE_MESA_CERRADA,
  esCierreDeEstaSesion,
  EVENTO_SEGUIR_MESA,
  EVENTO_SESION_CERRADA,
  TITULO_MESA_CERRADA,
} from "@/components/mesa-cerrada/sesion-mesa.utils";

// BL-518: la carta se entera de que el mozo cerró la mesa.

describe("esCierreDeEstaSesion", () => {
  it("el aviso de esta sesión cierra la pantalla", () => {
    expect(esCierreDeEstaSesion({ sesionMesa: "s2" }, "s2")).toBe(true);
  });

  it("el aviso de otra sesión de la mesa no la cierra", () => {
    expect(esCierreDeEstaSesion({ sesionMesa: "s1" }, "s2")).toBe(false);
  });

  it("un aviso sin sesión (el QR ya no sirve) también la cierra", () => {
    expect(esCierreDeEstaSesion({}, "s2")).toBe(true);
    expect(esCierreDeEstaSesion({ sesionMesa: 4 }, "s2")).toBe(true);
    expect(esCierreDeEstaSesion(null, "s2")).toBe(true);
    expect(esCierreDeEstaSesion(undefined, "s2")).toBe(true);
  });
});

describe("eventos y textos", () => {
  it("los mismos eventos que el backend (KdsGateway)", () => {
    expect(EVENTO_SEGUIR_MESA).toBe("mesa:seguir");
    expect(EVENTO_SESION_CERRADA).toBe("mesa:sesion_cerrada");
  });

  it("dice qué pasó y cómo volver a pedir", () => {
    expect(TITULO_MESA_CERRADA).toBe("Tu mesa se cerró");
    expect(DETALLE_MESA_CERRADA).toMatch(/Gracias por tu visita/);
    expect(DETALLE_MESA_CERRADA).toMatch(/escaneá el QR de nuevo/);
  });
});
