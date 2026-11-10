import {
  ESPERA_ENTRE_RECARGAS_MS,
  esErrorDeChunk,
  puedeRecargar,
} from "@/app/error.utils";

// BL-517: página de error. Recarga una vez cuando falla un chunk después de
// un deploy, sin entrar en loop.

describe("esErrorDeChunk", () => {
  it("reconoce el ChunkLoadError de webpack por el nombre", () => {
    const error = new Error("cualquier mensaje");
    error.name = "ChunkLoadError";
    expect(esErrorDeChunk(error)).toBe(true);
  });

  it("reconoce el mensaje «Loading chunk N failed»", () => {
    expect(
      esErrorDeChunk(
        new Error(
          "Loading chunk 4123 failed. (error: https://ejemplo/_next/static/chunks/4123.js)",
        ),
      ),
    ).toBe(true);
  });

  it("reconoce un chunk con nombre y el de CSS", () => {
    expect(esErrorDeChunk(new Error("Loading chunk app-pago failed."))).toBe(
      true,
    );
    expect(esErrorDeChunk(new Error("Loading CSS chunk 77 failed."))).toBe(
      true,
    );
  });

  it("no confunde otros errores con uno de chunk", () => {
    expect(
      esErrorDeChunk(new Error("Cannot read properties of undefined")),
    ).toBe(false);
    expect(esErrorDeChunk(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("tolera un error vacío", () => {
    expect(esErrorDeChunk(null)).toBe(false);
    expect(esErrorDeChunk(undefined)).toBe(false);
    expect(esErrorDeChunk({})).toBe(false);
  });
});

describe("puedeRecargar", () => {
  const ahora = 1_000_000;

  it("recarga si nunca recargó", () => {
    expect(puedeRecargar(ahora, null)).toBe(true);
  });

  it("no recarga si recargó hace menos de la espera (evita el loop)", () => {
    expect(puedeRecargar(ahora, String(ahora - 1_000))).toBe(false);
    expect(
      puedeRecargar(ahora, String(ahora - ESPERA_ENTRE_RECARGAS_MS + 1)),
    ).toBe(false);
  });

  it("vuelve a recargar pasada la espera (un deploy posterior)", () => {
    expect(puedeRecargar(ahora, String(ahora - ESPERA_ENTRE_RECARGAS_MS))).toBe(
      true,
    );
  });

  it("recarga si la marca guardada no es un número", () => {
    expect(puedeRecargar(ahora, "")).toBe(true);
    expect(puedeRecargar(ahora, "basura")).toBe(true);
  });
});
