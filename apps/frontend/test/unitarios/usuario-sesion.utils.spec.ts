import {
  iniciales,
  nombreCompleto,
  nombreRol,
  usuarioSesion,
} from "@/components/providers/usuario-sesion.utils";

/** BL-349: lo que se muestra de la persona que inició sesión. */

describe("nombreCompleto", () => {
  it("usa el claim name", () => {
    expect(nombreCompleto({ name: "Ana Pérez", given_name: "Ana" })).toBe(
      "Ana Pérez",
    );
  });

  it("sin name, arma nombre y apellido", () => {
    expect(nombreCompleto({ given_name: "Ana", family_name: "Pérez" })).toBe(
      "Ana Pérez",
    );
  });

  it("con solo el nombre o solo el apellido, usa el que haya", () => {
    expect(nombreCompleto({ given_name: "Ana" })).toBe("Ana");
    expect(nombreCompleto({ family_name: "Pérez" })).toBe("Pérez");
  });

  it("limpia espacios de más y descarta los vacíos", () => {
    expect(nombreCompleto({ name: "  Ana   Pérez " })).toBe("Ana Pérez");
    expect(nombreCompleto({ name: "   " })).toBeUndefined();
    expect(nombreCompleto({})).toBeUndefined();
  });
});

describe("iniciales", () => {
  it("toma la primera letra del nombre y del apellido", () => {
    expect(iniciales("Ana Pérez", "ana.perez")).toBe("AP");
  });

  it("con más de dos palabras, usa la primera y la última", () => {
    expect(iniciales("Ana María Pérez", undefined)).toBe("AP");
  });

  it("con una sola palabra, devuelve una letra", () => {
    expect(iniciales("Ana", undefined)).toBe("A");
  });

  it("pasa a mayúscula, también con tilde", () => {
    expect(iniciales("álvaro ñandú", undefined)).toBe("ÁÑ");
  });

  it("sin nombre, usa el usuario separado por punto, guion o guion bajo", () => {
    expect(iniciales(undefined, "ana.perez")).toBe("AP");
    expect(iniciales(undefined, "juan-gomez")).toBe("JG");
    expect(iniciales(undefined, "admin_test")).toBe("AT");
    expect(iniciales(undefined, "cocina")).toBe("C");
  });

  it("sin nombre ni usuario, devuelve «?»", () => {
    expect(iniciales(undefined, undefined)).toBe("?");
    expect(iniciales("  ", "")).toBe("?");
  });
});

describe("nombreRol", () => {
  it("traduce cada rol del personal", () => {
    expect(nombreRol(["ADMIN"])).toBe("Administrador");
    expect(nombreRol(["MOZO"])).toBe("Mozo");
    expect(nombreRol(["COCINA"])).toBe("Cocina");
    expect(nombreRol(["PLATAFORMA"])).toBe("Plataforma");
  });

  it("con varios roles, muestra el de mayor prioridad", () => {
    expect(nombreRol(["MOZO", "ADMIN"])).toBe("Administrador");
    expect(nombreRol(["COCINA", "MOZO"])).toBe("Mozo");
  });

  it("ignora los roles internos de Keycloak y el de comensal", () => {
    expect(
      nombreRol([
        "offline_access",
        "uma_authorization",
        "default-roles-bistrolink",
      ]),
    ).toBeUndefined();
    expect(nombreRol(["COMENSAL"])).toBeUndefined();
    expect(nombreRol([])).toBeUndefined();
  });
});

describe("usuarioSesion", () => {
  it("con nombre cargado: «Ana Pérez», iniciales «AP»", () => {
    expect(
      usuarioSesion(
        {
          preferred_username: "ana.perez",
          given_name: "Ana",
          family_name: "Pérez",
          name: "Ana Pérez",
        },
        ["ADMIN", "offline_access"],
      ),
    ).toEqual({
      nombreUsuario: "ana.perez",
      nombre: "Ana Pérez",
      iniciales: "AP",
      rol: "Administrador",
    });
  });

  it("sin nombre, muestra el usuario", () => {
    expect(usuarioSesion({ preferred_username: "mozo1" }, ["MOZO"])).toEqual({
      nombreUsuario: "mozo1",
      nombre: "mozo1",
      iniciales: "M",
      rol: "Mozo",
    });
  });

  it("sin token, no falla", () => {
    expect(usuarioSesion(undefined, [])).toEqual({
      nombreUsuario: undefined,
      nombre: undefined,
      iniciales: "?",
      rol: undefined,
    });
  });

  it("no expone el correo aunque el token lo traiga", () => {
    const claims = {
      preferred_username: "ana.perez",
      email: "ana@ejemplo.com",
    };
    expect(JSON.stringify(usuarioSesion(claims, ["ADMIN"]))).not.toContain("@");
  });
});
