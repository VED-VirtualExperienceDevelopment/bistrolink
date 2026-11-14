import {
  formatearRut,
  rutaApiPrivacidad,
  rutaPrivacidad,
} from "@/components/privacidad/privacidad.utils";

// HU-036 (BL-206): política de privacidad del establecimiento.

const TENANT = "11111111-1111-1111-1111-111111111111";
const RESTAURANTE = "22222222-2222-2222-2222-222222222222";

describe("política de privacidad (HU-036, BL-206)", () => {
  it("el enlace lleva el QR de la mesa o los ids de la carta web", () => {
    expect(
      rutaPrivacidad({ tipo: "mesa", qrToken: "abc_DEF-123", sesionMesa: "s" }),
    ).toBe("/privacidad?qr=abc_DEF-123");
    expect(
      rutaPrivacidad({
        tipo: "publico",
        tenantId: TENANT,
        restauranteId: RESTAURANTE,
      }),
    ).toBe(`/privacidad?t=${TENANT}&r=${RESTAURANTE}`);
  });

  it("arma la ruta de la API según los parámetros de la página", () => {
    expect(rutaApiPrivacidad({ qr: "abc_DEF-123" })).toBe(
      "/menu/qr/abc_DEF-123/privacidad",
    );
    expect(rutaApiPrivacidad({ t: TENANT, r: RESTAURANTE })).toBe(
      `/menu/tenant/${TENANT}/restaurante/${RESTAURANTE}/privacidad`,
    );
  });

  it("sin parámetros o con parámetros inválidos no consulta la API (se muestra la política genérica)", () => {
    expect(rutaApiPrivacidad({})).toBeNull();
    expect(rutaApiPrivacidad({ qr: "../../admin" })).toBeNull();
    expect(rutaApiPrivacidad({ t: "no-es-uuid", r: RESTAURANTE })).toBeNull();
    expect(rutaApiPrivacidad({ t: TENANT })).toBeNull();
  });

  it("formatea el RUT de 12 dígitos y deja igual otro formato", () => {
    expect(formatearRut("219999990016")).toBe("21 999999 0016");
    expect(formatearRut("123")).toBe("123");
  });
});

describe("rutaPrivacidad con el link de pago (HU-033, BL-203)", () => {
  it("la política general, sin el token del link en la URL", () => {
    expect(rutaPrivacidad({ tipo: "link", linkToken: "secreto" })).toBe(
      "/privacidad",
    );
  });
});
