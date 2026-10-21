import {
  avisoDeCopia,
  construirPedidoAlta,
  contrasenasSinCopiar,
  credencialesAMostrar,
  describirCreadoPor,
  esAltaIncompleta,
  esEmailValido,
  etiquetaPlan,
  formatearFechaAlta,
  FORMULARIO_VACIO,
  formularioParaCompletar,
  mensajeDeError,
  resumirAlta,
  resumirPagina,
  rutaListado,
  totalPaginas,
  validarFormulario,
} from "@/components/plataforma/plataforma.utils";
import type {
  EstablecimientoListado,
  FormularioAlta,
  ResultadoAlta,
} from "@/types/plataforma";

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

describe("esEmailValido", () => {
  it("acepta un email con usuario, dominio y extensión", () => {
    expect(esEmailValido("admin@prueba.uy")).toBe(true);
    expect(esEmailValido("ana.perez@mail.prueba.com.uy")).toBe(true);
  });

  it("rechaza emails sin @, con más de una @ o con espacios", () => {
    expect(esEmailValido("no-es-email")).toBe(false);
    expect(esEmailValido("a@b@prueba.uy")).toBe(false);
    expect(esEmailValido("ana perez@prueba.uy")).toBe(false);
  });

  it("rechaza emails sin usuario o sin un punto dentro del dominio", () => {
    expect(esEmailValido("@prueba.uy")).toBe(false);
    expect(esEmailValido("admin@prueba")).toBe(false);
    expect(esEmailValido("admin@.uy")).toBe(false);
    expect(esEmailValido("admin@prueba.")).toBe(false);
  });

  it("responde rápido con entradas largas y maliciosas", () => {
    const inicio = Date.now();
    expect(esEmailValido("a@" + ".".repeat(50_000))).toBe(false);
    expect(Date.now() - inicio).toBeLessThan(100);
  });
});

describe("etiquetaPlan (BL-405)", () => {
  it("muestra el nombre de los planes conocidos", () => {
    expect(etiquetaPlan("BASICO")).toBe("Básico");
    expect(etiquetaPlan("basico")).toBe("Básico");
  });

  it("vuelve legible un plan que no está en la lista", () => {
    expect(etiquetaPlan("PRO_ANUAL")).toBe("Pro anual");
    expect(etiquetaPlan("PREMIUM")).toBe("Premium");
  });

  it("no rompe con un plan vacío", () => {
    expect(etiquetaPlan("")).toBe("");
  });
});

describe("resumirPagina (BL-405)", () => {
  it("anuncia la página y el total", () => {
    expect(resumirPagina({ total: 45, tamanoPagina: 20 }, 2)).toBe(
      "Página 2 de 3. 45 establecimientos",
    );
  });

  it("usa el singular con un solo establecimiento", () => {
    expect(resumirPagina({ total: 1, tamanoPagina: 20 }, 1)).toBe(
      "Página 1 de 1. 1 establecimiento",
    );
  });

  it("avisa cuando no hay establecimientos", () => {
    expect(resumirPagina({ total: 0, tamanoPagina: 20 }, 1)).toBe(
      "Todavía no hay establecimientos",
    );
  });
});

describe("resumirPagina con búsqueda (BL-406)", () => {
  it("dice qué se buscó", () => {
    expect(resumirPagina({ total: 3, tamanoPagina: 20 }, 1, " uno ")).toBe(
      "Página 1 de 1. 3 establecimientos coinciden con «uno»",
    );
    expect(resumirPagina({ total: 1, tamanoPagina: 20 }, 1, "uno")).toBe(
      "Página 1 de 1. 1 establecimiento coincide con «uno»",
    );
  });

  it("avisa cuando nada coincide", () => {
    expect(resumirPagina({ total: 0, tamanoPagina: 20 }, 1, "zzz")).toBe(
      "Ningún establecimiento coincide con «zzz»",
    );
  });
});

describe("rutaListado (BL-406)", () => {
  it("sin búsqueda, solo la página", () => {
    expect(rutaListado(2)).toBe("/plataforma/establecimientos?pagina=2");
    expect(rutaListado(1, "   ")).toBe("/plataforma/establecimientos?pagina=1");
  });

  it("con búsqueda, codificada y sin espacios de más", () => {
    expect(rutaListado(1, " Bar & Co ")).toBe(
      "/plataforma/establecimientos?pagina=1&q=Bar+%26+Co",
    );
  });
});

describe("alta incompleta (BL-407)", () => {
  const establecimiento: EstablecimientoListado = {
    tenantId: "aaaaaaaa-1111-4111-8111-111111111111",
    razonSocial: "Uno SRL",
    rut: "210000000001",
    plan: "BASICO",
    creadoPor: null,
    creadoEl: "2026-10-09T12:00:00Z",
    restaurante: null,
  };

  it("es incompleta si el tenant no tiene restaurante", () => {
    expect(esAltaIncompleta(establecimiento)).toBe(true);
    expect(
      esAltaIncompleta({
        ...establecimiento,
        restaurante: { id: "r-1", nombre: "Uno" },
      }),
    ).toBe(false);
  });

  it("el formulario para completar trae la razón social y el RUT del tenant, y el resto vacío", () => {
    expect(formularioParaCompletar(establecimiento)).toEqual({
      ...FORMULARIO_VACIO,
      razonSocial: "Uno SRL",
      rut: "210000000001",
    });
  });
});

describe("contraseñas temporales (BL-408)", () => {
  const credenciales = [
    {
      rol: "ADMIN" as const,
      username: "uno-admin",
      keycloakId: "k1",
      creado: true,
      passwordGenerada: "x",
    },
    {
      rol: "COCINA" as const,
      username: "uno-cocina",
      keycloakId: "k2",
      creado: true,
      passwordGenerada: "y",
    },
  ];

  it("lista las que todavía no se copiaron", () => {
    expect(contrasenasSinCopiar(credenciales, new Set())).toEqual([
      "uno-admin",
      "uno-cocina",
    ]);
    expect(contrasenasSinCopiar(credenciales, new Set(["uno-admin"]))).toEqual([
      "uno-cocina",
    ]);
  });

  it("no queda ninguna cuando se copiaron todas", () => {
    expect(
      contrasenasSinCopiar(credenciales, new Set(["uno-admin", "uno-cocina"])),
    ).toEqual([]);
  });

  it("avisa con el rol si se copió o si falló", () => {
    expect(avisoDeCopia("COCINA", true)).toBe("Contraseña de Cocina copiada");
    expect(avisoDeCopia("ADMIN", false)).toBe(
      "No se pudo copiar la contraseña de Administrador. Quedó seleccionada: copiala con Ctrl+C.",
    );
  });
});
