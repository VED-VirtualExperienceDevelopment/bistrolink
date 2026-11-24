import { ApiError } from "@/lib/api-client";
import {
  cuerpoValoracion,
  CODIGO_YA_VALORADO,
  MENSAJE_DEMASIADOS_INTENTOS,
  MENSAJE_ERROR_VALORACION,
  nombreEstrella,
  resultadoDelError,
  rutaValoracion,
} from "@/components/valoracion/valoracion.utils";

/** HU-050 (BL-558): valoración privada del pedido (comensal). */
describe("valoración del pedido (HU-050, BL-558)", () => {
  it("[TC-U-586] cada estrella tiene un nombre accesible con la cantidad y su significado", () => {
    expect(nombreEstrella(1)).toBe("1 de 5: Malo");
    expect(nombreEstrella(4)).toBe("4 de 5: Muy bueno");
    expect(nombreEstrella(5)).toBe("5 de 5: Excelente");
  });

  it("el comentario va solo si tiene texto, recortado", () => {
    expect(cuerpoValoracion(4, "  Rico  ")).toEqual({
      estrellas: 4,
      comentario: "Rico",
    });
    expect(cuerpoValoracion(3, "   ")).toEqual({ estrellas: 3 });
  });

  it("la ruta lleva el pedido codificado", () => {
    expect(rutaValoracion("abc/1")).toBe("/pedidos/abc%2F1/valoracion");
  });

  it("[TC-U-587] si ya estaba valorado no es un error; 429, 409, 410 y otros tienen su mensaje", () => {
    expect(
      resultadoDelError(new ApiError(409, "Ya valoraste", CODIGO_YA_VALORADO)),
    ).toEqual({ tipo: "ya-valorada" });
    expect(resultadoDelError(new ApiError(429, "Too Many"))).toEqual({
      tipo: "error",
      mensaje: MENSAJE_DEMASIADOS_INTENTOS,
    });
    expect(
      resultadoDelError(
        new ApiError(409, "Podés valorar tu pedido cuando te lo entreguen"),
      ),
    ).toEqual({
      tipo: "error",
      mensaje: "Podés valorar tu pedido cuando te lo entreguen",
    });
    expect(resultadoDelError(new ApiError(410, "La mesa se cerró"))).toEqual({
      tipo: "error",
      mensaje: "La mesa se cerró",
    });
    expect(resultadoDelError(new ApiError(500, "boom"))).toEqual({
      tipo: "error",
      mensaje: MENSAJE_ERROR_VALORACION,
    });
    expect(resultadoDelError(new TypeError("fetch failed"))).toEqual({
      tipo: "error",
      mensaje: MENSAJE_ERROR_VALORACION,
    });
  });
});
