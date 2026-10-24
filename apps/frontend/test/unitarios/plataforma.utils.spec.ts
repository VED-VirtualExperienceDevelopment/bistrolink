import {
  avisoDeCopia,
  avisoPedidosAbiertos,
  cambiosDeEdicion,
  errorDeMotivo,
  LARGO_MAXIMO_MOTIVO,
  mensajeErrorCambioEstado,
  motivoLimpio,
  rutaReactivar,
  rutaSuspender,
  errorDeRut,
  normalizarRut,
  construirPedidoAlta,
  contrasenasSinCopiar,
  credencialesAMostrar,
  describirCreadoPor,
  describirCriterio,
  ETIQUETA_ESTADO,
  esAltaIncompleta,
  esEmailValido,
  etiquetaPlan,
  filtroEstadoDesde,
  formatearFechaAlta,
  formularioEdicionDesde,
  FORMULARIO_VACIO,
  formularioParaCompletar,
  mensajeDeError,
  mensajeErrorEdicion,
  mensajeErrorFicha,
  nombreDeCuenta,
  OPCIONES_FILTRO_ESTADO,
  opcionesPlan,
  resumirAlta,
  resumirPagina,
  rutaFicha,
  rutaListado,
  totalPaginas,
  validarEdicion,
  validarFormulario,
} from "@/components/plataforma/plataforma.utils";
import type {
  EstablecimientoListado,
  FichaEstablecimiento,
  FormularioAlta,
  ResultadoAlta,
} from "@/types/plataforma";

/** BL-163 (HU-027): lógica pura de la pantalla /plataforma. */

const VALIDO: FormularioAlta = {
  razonSocial: "Restaurante de Prueba SRL",
  rut: "219999990016",
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

  it.each([
    "21999999001",
    "2199999900166",
    "abcdefghijkl",
    "219999999901", // sin «001» (el RUT de prueba anterior a BL-409)
    "219999990017", // dígito verificador equivocado
    "211000060010", // los 11 primeros no admiten verificador
  ])("rechaza el RUT %p", (rut) => {
    expect(validarFormulario({ ...VALIDO, rut }).rut).toBeDefined();
  });

  it.each([
    "Prueba-Admin",
    "ab",
    "con espacio",
    "-admin",
    "12345678",
    "1admin",
  ])("rechaza el username %p", (adminUsername) => {
    expect(
      validarFormulario({ ...VALIDO, adminUsername }).adminUsername,
    ).toBeDefined();
  });

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
      rut: "219999990016",
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

  it("BL-356: acepta un email de 254 caracteres y rechaza uno de 255", () => {
    // "@prueba.uy" tiene 10 caracteres.
    const email = (largo: number) => `${"a".repeat(largo - 10)}@prueba.uy`;
    expect(email(254)).toHaveLength(254);
    expect(email(255)).toHaveLength(255);
    expect(esEmailValido(email(254))).toBe(true);
    expect(esEmailValido(email(255))).toBe(false);
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

describe("filtro por estado (BL-410)", () => {
  it("las opciones van en el orden de la pantalla, con texto para personas", () => {
    expect(OPCIONES_FILTRO_ESTADO).toEqual([
      { valor: "ACTIVOS", etiqueta: "Activos" },
      { valor: "SUSPENDIDOS", etiqueta: "Suspendidos" },
      { valor: "ALTA_INCOMPLETA", etiqueta: "Alta incompleta" },
    ]);
  });

  it("toma el valor del select; vacío o desconocido es «todos»", () => {
    expect(filtroEstadoDesde("SUSPENDIDOS")).toBe("SUSPENDIDOS");
    expect(filtroEstadoDesde("")).toBeUndefined();
    expect(filtroEstadoDesde("OTRO")).toBeUndefined();
  });

  it("describe la búsqueda, el filtro o los dos", () => {
    expect(describirCriterio()).toBe("");
    expect(describirCriterio(" uno ")).toBe("«uno»");
    expect(describirCriterio("", "SUSPENDIDOS")).toBe(
      "el filtro «Suspendidos»",
    );
    expect(describirCriterio("uno", "ALTA_INCOMPLETA")).toBe(
      "«uno» y el filtro «Alta incompleta»",
    );
  });

  it("el resumen de la página incluye el filtro", () => {
    expect(
      resumirPagina({ total: 2, tamanoPagina: 20 }, 1, "", "SUSPENDIDOS"),
    ).toBe(
      "Página 1 de 1. 2 establecimientos coinciden con el filtro «Suspendidos»",
    );
    expect(
      resumirPagina({ total: 0, tamanoPagina: 20 }, 1, "uno", "ACTIVOS"),
    ).toBe("Ningún establecimiento coincide con «uno» y el filtro «Activos»");
  });

  it("la ruta lleva el estado, junto con la búsqueda", () => {
    expect(rutaListado(1, "", "ALTA_INCOMPLETA")).toBe(
      "/plataforma/establecimientos?pagina=1&estado=ALTA_INCOMPLETA",
    );
    expect(rutaListado(2, "uno", "SUSPENDIDOS")).toBe(
      "/plataforma/establecimientos?pagina=2&q=uno&estado=SUSPENDIDOS",
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
    estado: "ALTA_INCOMPLETA",
  };

  it("BL-410: es incompleta según el estado que manda el backend", () => {
    expect(esAltaIncompleta(establecimiento)).toBe(true);
    // Alta cortada en Keycloak: ya tiene restaurante y sigue incompleta.
    expect(
      esAltaIncompleta({
        ...establecimiento,
        restaurante: { id: "r-1", nombre: "Uno" },
      }),
    ).toBe(true);
    expect(
      esAltaIncompleta({
        ...establecimiento,
        restaurante: { id: "r-1", nombre: "Uno" },
        estado: "ACTIVO",
      }),
    ).toBe(false);
    expect(esAltaIncompleta({ ...establecimiento, estado: "SUSPENDIDO" })).toBe(
      false,
    );
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

describe("RUT (BL-409)", () => {
  it("saca espacios, puntos y guiones", () => {
    expect(normalizarRut(" 21.999999-001-6 ")).toBe("219999990016");
  });

  it.each(["219999990016", "21.999999-001-6", "219999980010", "019999990013"])(
    "acepta %p",
    (rut) => {
      expect(errorDeRut(rut)).toBeUndefined();
    },
  );

  it("dice qué está mal", () => {
    expect(errorDeRut("2199")).toMatch(/12 dígitos/);
    expect(errorDeRut("239999990013")).toMatch(/primeros 8/);
    expect(errorDeRut("210000000019")).toMatch(/primeros 8/);
    expect(errorDeRut("219999999901")).toMatch(/001/);
    expect(errorDeRut("219999990017")).toMatch(/verificador/);
  });

  it("el pedido de alta lleva el RUT sin separadores", () => {
    expect(construirPedidoAlta({ ...VALIDO, rut: "21.999999-001-6" }).rut).toBe(
      "219999990016",
    );
  });
});

describe("ficha del establecimiento (BL-411)", () => {
  it("la ruta de la ficha lleva el id codificado", () => {
    expect(rutaFicha("11111111-1111-1111-1111-111111111111")).toBe(
      "/plataforma/establecimientos/11111111-1111-1111-1111-111111111111",
    );
    expect(rutaFicha("a/b")).toBe("/plataforma/establecimientos/a%2Fb");
  });

  it("cada estado tiene su nombre para personas", () => {
    expect(ETIQUETA_ESTADO).toEqual({
      ACTIVO: "Activo",
      SUSPENDIDO: "Suspendido",
      ALTA_INCOMPLETA: "Alta incompleta",
    });
  });

  it("muestra el nombre y apellido de la cuenta, o el usuario si no tiene", () => {
    const cuenta = {
      username: "uno-admin",
      nombre: "Ana",
      apellido: "Gómez",
      activo: true,
    };
    expect(nombreDeCuenta(cuenta)).toBe("Ana Gómez");
    expect(nombreDeCuenta({ ...cuenta, apellido: null })).toBe("Ana");
    expect(nombreDeCuenta({ ...cuenta, nombre: " ", apellido: null })).toBe(
      "uno-admin",
    );
    expect(
      nombreDeCuenta({
        ...cuenta,
        nombre: null,
        apellido: null,
        username: null,
      }),
    ).toBe("Sin nombre");
  });

  it("explica el 404 y el 400 de la ficha", () => {
    expect(mensajeErrorFicha(404, "Not Found")).toMatch(
      /No existe un establecimiento/,
    );
    expect(mensajeErrorFicha(400, "Bad Request")).toBe(
      "El enlace de la ficha no es válido.",
    );
    expect(mensajeErrorFicha(500, "Error interno")).toBe("Error interno");
  });
});

describe("editar los datos del establecimiento (BL-412)", () => {
  const ficha: FichaEstablecimiento = {
    tenantId: "aaaaaaaa-1111-4111-8111-111111111111",
    razonSocial: "Uno SRL",
    rut: "219999990016",
    plan: "BASICO",
    creadoPor: null,
    creadoEl: "2026-10-09T12:00:00Z",
    estado: "ACTIVO",
    altaCompletadaEn: "2026-10-09T12:05:00Z",
    suspension: null,
    restaurante: {
      id: "r-1",
      nombre: "Restaurante Uno",
      direccion: "Calle 1",
      timezone: "America/Montevideo",
    },
    administradores: [],
    cocina: [],
    resumen: null,
  };

  it("el formulario arranca con los datos de la ficha", () => {
    expect(formularioEdicionDesde(ficha)).toEqual({
      razonSocial: "Uno SRL",
      rut: "219999990016",
      plan: "BASICO",
      restauranteNombre: "Restaurante Uno",
      restauranteDireccion: "Calle 1",
    });
    expect(
      formularioEdicionDesde({ ...ficha, restaurante: null }),
    ).toMatchObject({ restauranteNombre: "", restauranteDireccion: "" });
  });

  it("sin cambios, el body queda vacío", () => {
    expect(cambiosDeEdicion(ficha, formularioEdicionDesde(ficha))).toEqual({});
  });

  it("manda solo lo que cambió, sin espacios de más y el RUT sin separadores", () => {
    expect(
      cambiosDeEdicion(ficha, {
        ...formularioEdicionDesde(ficha),
        razonSocial: "  Uno   y Cía SRL ",
        rut: "21.123456.001-9",
        restauranteDireccion: " Calle 2 ",
      }),
    ).toEqual({
      razonSocial: "Uno y Cía SRL",
      rut: "211234560019",
      restauranteDireccion: "Calle 2",
    });
  });

  it("el mismo RUT escrito con separadores no cuenta como cambio", () => {
    expect(
      cambiosDeEdicion(ficha, {
        ...formularioEdicionDesde(ficha),
        rut: "21.999999.001-6",
      }),
    ).toEqual({});
  });

  it("sin restaurante, no manda sus datos", () => {
    const sinRestaurante = { ...ficha, restaurante: null };
    expect(
      cambiosDeEdicion(sinRestaurante, {
        ...formularioEdicionDesde(sinRestaurante),
        restauranteNombre: "Algo",
      }),
    ).toEqual({});
  });

  it("valida razón social, RUT y, si tiene restaurante, sus datos", () => {
    const vacio = {
      razonSocial: " ",
      rut: "219999990017",
      plan: "BASICO",
      restauranteNombre: "",
      restauranteDireccion: "a".repeat(201),
    };
    expect(validarEdicion(vacio, true)).toEqual({
      razonSocial: "Obligatorio",
      rut: "No es un RUT válido: el último dígito (verificador) no corresponde",
      restauranteNombre: "Obligatorio",
      restauranteDireccion: "Máximo 200 caracteres",
    });
    expect(Object.keys(validarEdicion(vacio, false)).sort()).toEqual([
      "razonSocial",
      "rut",
    ]);
    expect(validarEdicion(formularioEdicionDesde(ficha), true)).toEqual({});
  });

  it("los planes incluyen el actual aunque no esté en la lista", () => {
    expect(opcionesPlan("BASICO")).toEqual([
      { valor: "BASICO", etiqueta: "Básico" },
    ]);
    expect(opcionesPlan("PRO_ANUAL")).toEqual([
      { valor: "BASICO", etiqueta: "Básico" },
      { valor: "PRO_ANUAL", etiqueta: "Pro anual" },
    ]);
  });

  it("los 409 y 400 se muestran con el mensaje del backend", () => {
    expect(
      mensajeErrorEdicion(409, "El RUT ya pertenece a otro establecimiento"),
    ).toBe("El RUT ya pertenece a otro establecimiento");
    expect(mensajeErrorEdicion(429, "Too Many Requests")).toMatch(/límite/);
  });
});

describe("BL-413: suspender y reactivar", () => {
  const ID = "11111111-1111-1111-1111-111111111111";

  it("[TC-U-139] rutas de la API para suspender y reactivar", () => {
    expect(rutaSuspender(ID)).toBe(
      `/plataforma/establecimientos/${ID}/suspender`,
    );
    expect(rutaReactivar(ID)).toBe(
      `/plataforma/establecimientos/${ID}/reactivar`,
    );
    expect(rutaSuspender("a/b")).toBe(
      "/plataforma/establecimientos/a%2Fb/suspender",
    );
  });

  it("[TC-U-140] el motivo es obligatorio, de 3 a 200 caracteres sin contar espacios de más", () => {
    expect(errorDeMotivo("")).toMatch(/motivo/);
    expect(errorDeMotivo("    ")).toMatch(/motivo/);
    expect(errorDeMotivo(" ab ")).toMatch(/Al menos 3/);
    expect(errorDeMotivo("abc")).toBeUndefined();
    expect(errorDeMotivo("a".repeat(LARGO_MAXIMO_MOTIVO))).toBeUndefined();
    expect(errorDeMotivo("a".repeat(LARGO_MAXIMO_MOTIVO + 1))).toMatch(
      /Máximo 200/,
    );
    expect(motivoLimpio("  Falta   de pago ")).toBe("Falta de pago");
  });

  it("[TC-U-141] avisa los pedidos abiertos, en singular y en plural, y nada si no hay", () => {
    expect(avisoPedidosAbiertos(0)).toBeNull();
    expect(avisoPedidosAbiertos(undefined)).toBeNull();
    expect(avisoPedidosAbiertos(1)).toMatch(
      /^Hay 1 pedido abierto\. No se cancela,/,
    );
    expect(avisoPedidosAbiertos(3)).toMatch(
      /^Hay 3 pedidos abiertos\. No se cancelan,/,
    );
  });

  it("los 409 y 404 se muestran con el mensaje del backend; 429, 401 y 403 con uno propio", () => {
    expect(
      mensajeErrorCambioEstado(409, "El establecimiento ya está suspendido"),
    ).toBe("El establecimiento ya está suspendido");
    expect(mensajeErrorCambioEstado(429, "Too Many Requests")).toMatch(
      /límite/,
    );
    expect(mensajeErrorCambioEstado(401, "Unauthorized")).toMatch(/sesión/);
    expect(mensajeErrorCambioEstado(403, "Forbidden")).toMatch(/permiso/);
  });
});
