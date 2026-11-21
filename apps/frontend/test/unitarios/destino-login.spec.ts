import {
  DESTINO_POR_DEFECTO,
  destinoDespuesDelLogin,
} from "@/app/login/destino-login";

// BL-598: después del login solo se vuelve a rutas de esta aplicación.

describe("destinoDespuesDelLogin", () => {
  it("[TC-U-651] devuelve la ruta interna tal cual, con su query y su ancla", () => {
    expect(destinoDespuesDelLogin("/admin/usuarios")).toBe("/admin/usuarios");
    expect(destinoDespuesDelLogin("/admin/mesas/pedido?mesa=3#detalle")).toBe(
      "/admin/mesas/pedido?mesa=3#detalle",
    );
    expect(destinoDespuesDelLogin("/")).toBe("/");
  });

  it("[TC-U-652] sin valor, vuelve al inicio", () => {
    expect(destinoDespuesDelLogin(null)).toBe(DESTINO_POR_DEFECTO);
    expect(destinoDespuesDelLogin(undefined)).toBe(DESTINO_POR_DEFECTO);
    expect(destinoDespuesDelLogin("")).toBe(DESTINO_POR_DEFECTO);
  });

  it("[TC-U-653] una URL completa o un valor sin «/» inicial vuelve al inicio", () => {
    for (const valor of [
      "https://ejemplo.com/admin",
      "http://ejemplo.com",
      "javascript:alert(1)",
      "admin/usuarios",
      "ejemplo.com",
    ]) {
      expect(destinoDespuesDelLogin(valor)).toBe(DESTINO_POR_DEFECTO);
    }
  });

  it("[TC-U-654] una ruta que al resolverse apunta a otro sitio vuelve al inicio", () => {
    for (const valor of [
      "//ejemplo.com",
      "//ejemplo.com/admin",
      "/\\ejemplo.com",
      "/\t/ejemplo.com",
      "/\n/ejemplo.com",
    ]) {
      expect(destinoDespuesDelLogin(valor)).toBe(DESTINO_POR_DEFECTO);
    }
  });
});
