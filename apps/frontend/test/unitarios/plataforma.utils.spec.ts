import {
  construirPedidoAlta,
  credencialesAMostrar,
  describirCreadoPor,
  formatearFechaAlta,
  FORMULARIO_VACIO,
  mensajeDeError,
  resumirAlta,
  totalPaginas,
  validarFormulario,
} from "@/components/plataforma/plataforma.utils";
import type { FormularioAlta, ResultadoAlta } from "@/types/plataforma";

/** BL-163 (HU-027): lógica pura de la pantalla /plataforma. */

const VALIDO: FormularioAlta = {
  razonSocial: "Restaurante de Prueba SRL",
  rut: "219999999901",
  restauranteNombre: "Restaurante de Prueba",
  restauranteDireccion: "Calle 123",
  adminUsername: "prueba-admin",
  adminEmail: "admin@prueba.uy",
  adminNombre: "Ana",
  adminApellido: "Pérez",
  cocinaUsername: "prueba-cocina",
  cocinaEmail: "",
};

function resultado(parcial: Partial<ResultadoAlta> = {}): ResultadoAlta {
  return {
    tenantId: "t-1",
    tenantCreado: true,
    restauranteId: "r-1",
    restauranteCreado: true,
    mesaVirtualId: "m-0",
    usuarios: [
      {
        rol: "ADMIN",
        username: "prueba-admin",
        keycloakId: "k1",
        creado: true,
        passwordGenerada: "Temp-1",
      },
      {
        rol: "COCINA",
        username: "prueba-cocina",
        keycloakId: "k2",
        creado: true,
        passwordGenerada: "Temp-2",
      },
      {
        rol: "COMENSAL",
        username: "comensal-t-1",
        keycloakId: "k3",
        creado: true,
      },
    ],
    ...parcial,
  };
}

describe("validarFormulario", () => {
  it("un formulario completo y válido no tiene errores", () => {
    expect(validarFormulario(VALIDO)).toEqual({});
  });

  it("el formulario vacío marca todos los obligatorios", () => {
    expect(Object.keys(validarFormulario(FORMULARIO_VACIO)).sort()).toEqual(
      [
        "adminApellido",
        "adminEmail",
        "adminNombre",
        "adminUsername",
        "cocinaUsername",
        "razonSocial",
        "restauranteDireccion",
        "restauranteNombre",
        "rut",
      ].sort(),
    );
  });

  it.each(["21999999990", "2199999999011", "21.999.999.9901", "abcdefghijkl"])(
    "rechaza el RUT %p",
    (rut) => {
      expect(validarFormulario({ ...VALIDO, rut }).rut).toBeDefined();
    },
  );

  it.each(["Prueba-Admin", "ab", "con espacio", "-admin"])(
    "rechaza el username %p",
    (adminUsername) => {
      expect(
        validarFormulario({ ...VALIDO, adminUsername }).adminUsername,
      ).toBeDefined();
    },
  );

  it("rechaza usernames reservados para el comensal técnico", () => {
    expect(
      validarFormulario({ ...VALIDO, cocinaUsername: "comensal-x" })
        .cocinaUsername,
    ).toMatch(/reservados/);
  });

  it("Administrador y Cocina tienen que tener usernames distintos", () => {
    expect(
      validarFormulario({ ...VALIDO, cocinaUsername: "prueba-admin" })
        .cocinaUsername,
    ).toMatch(/distinto/);
  });

  it("el email de Cocina es opcional, pero si viene tiene que ser válido", () => {
    expect(
      validarFormulario({ ...VALIDO, cocinaEmail: "" }).cocinaEmail,
    ).toBeUndefined();
    expect(
      validarFormulario({ ...VALIDO, cocinaEmail: "no-es-email" }).cocinaEmail,
    ).toBeDefined();
  });

  it("respeta los largos máximos del backend", () => {
    expect(
      validarFormulario({ ...VALIDO, razonSocial: "x".repeat(201) })
        .razonSocial,
    ).toMatch(/200/);
    expect(
      validarFormulario({ ...VALIDO, adminNombre: "x".repeat(81) }).adminNombre,
    ).toMatch(/80/);
  });
});

describe("construirPedidoAlta", () => {
  it("arma el body del backend, sin contraseñas, con los textos recortados", () => {
    const pedido = construirPedidoAlta({
      ...VALIDO,
      razonSocial: "  Restaurante de Prueba SRL  ",
    });

    expect(pedido).toEqual({
      razonSocial: "Restaurante de Prueba SRL",
      rut: "219999999901",
      restaurante: { nombre: "Restaurante de Prueba", direccion: "Calle 123" },
      admin: {
        username: "prueba-admin",
        email: "admin@prueba.uy",
        nombre: "Ana",
        apellido: "Pérez",
      },
      cocina: { username: "prueba-cocina" },
    });
    expect(JSON.stringify(pedido)).not.toMatch(/password/i);
  });

  it("incluye el email de Cocina solo si se escribió", () => {
    expect(
      construirPedidoAlta({ ...VALIDO, cocinaEmail: "cocina@prueba.uy" })
        .cocina,
    ).toEqual({
      username: "prueba-cocina",
      email: "cocina@prueba.uy",
    });
  });
});

describe("credencialesAMostrar y resumirAlta", () => {
  it("muestra solo las contraseñas generadas (Admin y Cocina; nunca la del comensal)", () => {
    expect(credencialesAMostrar(resultado()).map((u) => u.rol)).toEqual([
      "ADMIN",
      "COCINA",
    ]);
  });

  it("alta nueva", () => {
    expect(resumirAlta(resultado())).toMatch(/^Establecimiento creado/);
  });

  it("reintento sin cambios: lo dice y no hay contraseñas", () => {
    const repetido = resultado({
      tenantCreado: false,
      restauranteCreado: false,
      usuarios: resultado().usuarios.map((u) => ({
        ...u,
        creado: false,
        passwordGenerada: undefined,
      })),
    });

    expect(resumirAlta(repetido)).toMatch(/ya existía/);
    expect(credencialesAMostrar(repetido)).toEqual([]);
  });

  it("tenant existente al que le faltaba algo", () => {
    expect(resumirAlta(resultado({ tenantCreado: false }))).toMatch(
      /se completaron/,
    );
  });
});

describe("describirCreadoPor", () => {
  it.each([
    ["dev-daiana-plataforma", "dev-daiana-plataforma"],
    ["script:silve", "Script (silve)"],
    [null, "Sin registro"],
  ])("%p → %p", (creadoPor, esperado) => {
    expect(describirCreadoPor(creadoPor)).toBe(esperado);
  });
});

describe("formatearFechaAlta", () => {
  it("muestra la hora de Montevideo (UTC-3)", () => {
    expect(formatearFechaAlta("2026-10-09T17:30:00.000Z")).toBe(
      "09/10/2026 14:30",
    );
  });
});

describe("totalPaginas", () => {
  it.each([
    [0, 1],
    [1, 1],
    [20, 1],
    [21, 2],
    [45, 3],
  ])("%p establecimientos de a 20 → %p páginas", (total, esperado) => {
    expect(totalPaginas(total, 20)).toBe(esperado);
  });
});

describe("mensajeDeError", () => {
  it("traduce el límite de altas (429), la sesión vencida (401) y la falta de permiso (403)", () => {
    expect(
      mensajeDeError(429, "ThrottlerException: Too Many Requests"),
    ).toMatch(/límite/);
    expect(mensajeDeError(401, "Unauthorized")).toMatch(/sesión/);
    expect(mensajeDeError(403, "Rol requerido: PLATAFORMA")).toMatch(/permiso/);
  });

  it("el resto (por ejemplo, un 409 del backend) se muestra tal cual", () => {
    expect(
      mensajeDeError(409, "El RUT ya pertenece a otro establecimiento"),
    ).toBe("El RUT ya pertenece a otro establecimiento");
  });
});
