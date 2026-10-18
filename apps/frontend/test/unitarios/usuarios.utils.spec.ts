import {
  errorNombrePersona,
  esCuentaCocina,
  FILTROS_INICIALES,
  filtrarUsuarios,
  hayFiltrosActivos,
  nombreCompleto,
  nombreParaMostrar,
  normalizarParaBuscar,
  rutaUsuario,
  textoCantidadUsuarios,
} from "@/components/admin/usuarios/Usuarios.utils";
import type { Usuario } from "@/types/usuario";

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

/** BL-363: búsqueda y filtros del listado. */
describe("filtrarUsuarios", () => {
  const usuario = (datos: Partial<Usuario>): Usuario => ({
    id: datos.username ?? "id",
    keycloakId: "kc",
    restauranteId: null,
    rol: "MOZO",
    activo: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...datos,
  });

  const lista = [
    usuario({
      username: "jperez",
      nombre: "Juan",
      apellido: "Pérez",
      email: "juan@ejemplo.com",
    }),
    usuario({
      username: "ana.admin",
      nombre: "Ana",
      apellido: "Núñez",
      rol: "ADMIN",
    }),
    usuario({ username: "mozo-viejo", rol: "MOZO", activo: false }),
    usuario({
      username: "cocina-local",
      rol: "COCINA",
      cuentaCompartida: true,
    }),
  ];
  const usernames = (resultado: Usuario[]) => resultado.map((u) => u.username);

  it("por defecto muestra solo los activos, de todos los roles", () => {
    expect(usernames(filtrarUsuarios(lista, FILTROS_INICIALES))).toEqual([
      "jperez",
      "ana.admin",
      "cocina-local",
    ]);
  });

  it("buscar «perez» encuentra a «Pérez» (sin mayúsculas ni tildes)", () => {
    const filtros = { ...FILTROS_INICIALES, busqueda: "PEREZ" };
    expect(usernames(filtrarUsuarios(lista, filtros))).toEqual(["jperez"]);
  });

  it("busca también en el usuario, el nombre completo y el correo", () => {
    expect(
      usernames(
        filtrarUsuarios(lista, { ...FILTROS_INICIALES, busqueda: "ana.adm" }),
      ),
    ).toEqual(["ana.admin"]);
    expect(
      usernames(
        filtrarUsuarios(lista, {
          ...FILTROS_INICIALES,
          busqueda: "juan perez",
        }),
      ),
    ).toEqual(["jperez"]);
    expect(
      usernames(
        filtrarUsuarios(lista, { ...FILTROS_INICIALES, busqueda: "@ejemplo" }),
      ),
    ).toEqual(["jperez"]);
  });

  it("combina el rol, el estado y la búsqueda", () => {
    expect(
      usernames(
        filtrarUsuarios(lista, { busqueda: "", rol: "MOZO", estado: "TODOS" }),
      ),
    ).toEqual(["jperez", "mozo-viejo"]);
    expect(
      usernames(
        filtrarUsuarios(lista, {
          busqueda: "viejo",
          rol: "MOZO",
          estado: "INACTIVOS",
        }),
      ),
    ).toEqual(["mozo-viejo"]);
    expect(
      usernames(
        filtrarUsuarios(lista, {
          busqueda: "juan",
          rol: "ADMIN",
          estado: "TODOS",
        }),
      ),
    ).toEqual([]);
  });

  it("filtra la cuenta de cocina por el rol Cocina", () => {
    expect(
      usernames(
        filtrarUsuarios(lista, { ...FILTROS_INICIALES, rol: "COCINA" }),
      ),
    ).toEqual(["cocina-local"]);
  });
});

describe("normalizarParaBuscar, hayFiltrosActivos y textoCantidadUsuarios", () => {
  it("quita tildes y mayúsculas", () => {
    expect(normalizarParaBuscar("  Núñez PÉREZ ")).toBe("nunez perez");
  });

  it("detecta si hay algo distinto de los filtros iniciales", () => {
    expect(hayFiltrosActivos(FILTROS_INICIALES)).toBe(false);
    expect(hayFiltrosActivos({ ...FILTROS_INICIALES, busqueda: "  " })).toBe(
      false,
    );
    expect(hayFiltrosActivos({ ...FILTROS_INICIALES, busqueda: "ana" })).toBe(
      true,
    );
    expect(hayFiltrosActivos({ ...FILTROS_INICIALES, estado: "TODOS" })).toBe(
      true,
    );
  });

  it("dice la cantidad en singular o plural", () => {
    expect(textoCantidadUsuarios(1)).toBe("1 usuario");
    expect(textoCantidadUsuarios(0)).toBe("0 usuarios");
    expect(textoCantidadUsuarios(3)).toBe("3 usuarios");
  });
});
