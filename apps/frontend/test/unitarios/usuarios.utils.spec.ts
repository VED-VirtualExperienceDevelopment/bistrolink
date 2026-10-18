import {
  errorNombrePersona,
  esCuentaCocina,
  nombreCompleto,
  nombreParaMostrar,
  rutaUsuario,
} from "@/components/admin/usuarios/Usuarios.utils";

/** BL-361: nombre de cada usuario en la pantalla de Usuarios. */

const ID = "abcdef12-3456-7890-abcd-ef1234567890";

describe("nombreCompleto", () => {
  it("une nombre y apellido", () => {
    expect(nombreCompleto({ nombre: "Juan", apellido: "Pérez" })).toBe(
      "Juan Pérez",
    );
  });

  it("con solo uno de los dos, usa el que haya", () => {
    expect(nombreCompleto({ nombre: "Juan", apellido: null })).toBe("Juan");
    expect(nombreCompleto({ nombre: undefined, apellido: "Pérez" })).toBe(
      "Pérez",
    );
  });

  it("sin ninguno (usuarios anteriores a BL-361), devuelve undefined", () => {
    expect(nombreCompleto({ nombre: null, apellido: null })).toBeUndefined();
    expect(
      nombreCompleto({ nombre: "  ", apellido: undefined }),
    ).toBeUndefined();
  });
});

describe("nombreParaMostrar", () => {
  it("prefiere el nombre completo", () => {
    expect(
      nombreParaMostrar({
        id: ID,
        nombre: "Juan",
        apellido: "Pérez",
        username: "mozo1",
      }),
    ).toBe("Juan Pérez");
  });

  it("sin nombre, muestra el usuario", () => {
    expect(
      nombreParaMostrar({
        id: ID,
        nombre: null,
        apellido: null,
        username: "mozo1",
      }),
    ).toBe("mozo1");
  });

  it("sin nombre ni usuario, un identificador corto", () => {
    expect(nombreParaMostrar({ id: ID })).toBe("Usuario abcdef12");
  });
});

describe("errorNombrePersona", () => {
  it.each(["Juan", "María José", "O'Neill", "Pérez-Núñez", "  Ana  "])(
    "acepta %p",
    (valor) => {
      expect(errorNombrePersona(valor, "nombre")).toBeNull();
    },
  );

  it("vacío: pide el dato, con el nombre del campo", () => {
    expect(errorNombrePersona("  ", "nombre")).toBe("Ingresá el nombre.");
    expect(errorNombrePersona("", "apellido")).toBe("Ingresá el apellido.");
  });

  it("más de 60 caracteres: avisa el límite", () => {
    expect(errorNombrePersona("a".repeat(61), "nombre")).toBe(
      "Puede tener hasta 60 caracteres.",
    );
  });

  it.each(["123", "-Juan", "Juan2", "Juan & Ana", "Ana/Luis"])(
    "rechaza %p",
    (valor) => {
      expect(errorNombrePersona(valor, "apellido")).toMatch(/^Usá solo letras/);
    },
  );
});

/** BL-362: la cuenta de cocina usa sus propias rutas. */
describe("rutaUsuario y esCuentaCocina", () => {
  it("el personal usa /usuarios/:id", () => {
    const mozo = { id: ID, rol: "MOZO" as const, cuentaCompartida: false };
    expect(esCuentaCocina(mozo)).toBe(false);
    expect(rutaUsuario(mozo)).toBe(`/usuarios/${ID}`);
  });

  it("la cuenta de cocina usa /usuarios/cocina/:id", () => {
    const cocina = { id: ID, rol: "COCINA" as const, cuentaCompartida: true };
    expect(esCuentaCocina(cocina)).toBe(true);
    expect(rutaUsuario(cocina)).toBe(`/usuarios/cocina/${ID}`);
  });
});
