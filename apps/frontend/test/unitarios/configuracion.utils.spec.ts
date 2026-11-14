import {
  avisoPreseleccion,
  cambiosParaGuardar,
  errorEmailPrivacidad,
  errorRazonSocial,
  erroresCola,
  erroresDelFormulario,
  formularioDesde,
  hayErroresCola,
  primerCampoConError,
  hayCambios,
  urlDelLogo,
  errorDireccionLocal,
  errorNombreLocal,
  leerPropinas,
  sinMediosDePago,
  type ConfiguracionEstablecimiento,
  mensajeAnonimizacion,
  errorHorarioRetiro,
  mensajeAnonimizacionRetiro,
} from "@/components/admin/configuracion/configuracion.utils";

// HU-020 (BL-72): pantalla de configuración del establecimiento.

const GUARDADA: ConfiguracionEstablecimiento = {
  razonSocial: "Uno SRL",
  rut: "219999990016",
  efectivoHabilitado: true,
  mercadoPagoHabilitado: true,
  plexoHabilitado: false,
  handyHabilitado: false,
  propinasSugeridas: [10, 15],
  cfeProveedor: "SURTEC",
  mediosPagoDisponibles: ["EFECTIVO", "MERCADOPAGO"],
  proveedoresCfeDisponibles: ["SURTEC"],
};

describe("propinas sugeridas", () => {
  it("[TC-U-263] HU-020: lee porcentajes enteros separados por comas o espacios y los ordena", () => {
    expect(leerPropinas("20, 10 15")).toEqual({ propinas: [10, 15, 20] });
    expect(leerPropinas("10%, 15%")).toEqual({ propinas: [10, 15] });
    expect(leerPropinas("   ")).toEqual({ propinas: [] });
  });

  it("[TC-U-264] HU-020: rechaza decimales, texto, valores fuera de 1 a 100, repetidos y más de 5", () => {
    for (const texto of [
      "12.5",
      "diez",
      "0",
      "101",
      "10, 10",
      "5, 10, 15, 20, 25, 30",
    ]) {
      expect(leerPropinas(texto)).toHaveProperty("error");
    }
  });
});

describe("cambios para guardar", () => {
  it("[TC-U-265] HU-020: manda solo lo que cambió, con la razón social limpia y las propinas como lista", () => {
    const formulario = {
      ...formularioDesde(GUARDADA),
      razonSocial: "  Uno   y Cía SRL ",
      efectivoHabilitado: false,
      propinas: "15, 10, 20",
    };

    expect(cambiosParaGuardar(GUARDADA, formulario)).toEqual({
      razonSocial: "Uno y Cía SRL",
      efectivoHabilitado: false,
      propinasSugeridas: [10, 15, 20],
    });
  });

  it("sin cambios (aunque las propinas estén escritas de otra forma): nada que guardar", () => {
    const formulario = { ...formularioDesde(GUARDADA), propinas: "15,10" };

    const cambios = cambiosParaGuardar(GUARDADA, formulario);
    expect(cambios).toEqual({});
    expect(hayCambios(cambios)).toBe(false);
  });

  it("el formulario arranca con lo guardado", () => {
    expect(formularioDesde(GUARDADA)).toEqual({
      razonSocial: "Uno SRL",
      // HU-043 (BL-561): un backend anterior no los trae: sin los campos.
      nombreLocal: null,
      direccionLocal: null,
      efectivoHabilitado: true,
      mercadoPagoHabilitado: true,
      // HU-007b (BL-80): un backend anterior no lo trae: el default (true).
      posHabilitado: true,
      plexoHabilitado: false,
      handyHabilitado: false,
      propinas: "10, 15",
      // HU-022 (BL-495): un backend anterior no lo trae: apagada.
      propinaPreseleccionada: false,
      cfeProveedor: "SURTEC",
      emailPrivacidad: "",
      // HU-042 (BL-465): un backend anterior no trae la cola: desactivada,
      // con los valores que la pantalla propone al activarla.
      colaActiva: false,
      limitePreparacion: "5",
      umbralAlertaCola: "10",
      minutosPreparacion: "15",
      // HU-038 (BL-506): un backend anterior no trae los umbrales de espera:
      // los de por defecto.
      esperaAtencion: "30",
      esperaDemorado: "60",
      esperaDemoraAlta: "120",
      // HU-043 (BL-533): un backend anterior no trae la marca: la Clásica,
      // con el logo sin tocar.
      plantilla: "clasica",
      logo: { tipo: "guardado" },
      // HU-040 (BL-210): un backend anterior no trae el retiro: habilitado,
      // todo el día (el default de la columna).
      retiroHabilitado: true,
      retiroHoraDesde: "",
      retiroHoraHasta: "",
    });
  });
});

describe("HU-007b (BL-80): POS del local", () => {
  it("se lee de lo guardado y solo se manda si cambió", () => {
    const guardada = { ...GUARDADA, posHabilitado: false };
    const formulario = formularioDesde(guardada);
    expect(formulario.posHabilitado).toBe(false);
    expect(cambiosParaGuardar(guardada, formulario)).toEqual({});
    expect(
      cambiosParaGuardar(guardada, { ...formulario, posHabilitado: true }),
    ).toEqual({ posHabilitado: true });
  });

  it("con un backend anterior (sin el campo) no manda nada si no se tocó", () => {
    expect(cambiosParaGuardar(GUARDADA, formularioDesde(GUARDADA))).toEqual({});
    expect(
      cambiosParaGuardar(GUARDADA, {
        ...formularioDesde(GUARDADA),
        posHabilitado: false,
      }),
    ).toEqual({ posHabilitado: false });
  });
});

describe("HU-022 (BL-495): preselección de la propina", () => {
  it("el formulario la lee de lo guardado; un backend anterior (sin el campo) la deja apagada", () => {
    expect(formularioDesde(GUARDADA).propinaPreseleccionada).toBe(false);
    expect(
      formularioDesde({ ...GUARDADA, propinaPreseleccionada: true })
        .propinaPreseleccionada,
    ).toBe(true);
  });

  it("activarla manda solo ese campo; apagarla de nuevo también", () => {
    expect(
      cambiosParaGuardar(GUARDADA, {
        ...formularioDesde(GUARDADA),
        propinaPreseleccionada: true,
      }),
    ).toEqual({ propinaPreseleccionada: true });

    const activa = { ...GUARDADA, propinaPreseleccionada: true };
    expect(
      cambiosParaGuardar(activa, {
        ...formularioDesde(activa),
        propinaPreseleccionada: false,
      }),
    ).toEqual({ propinaPreseleccionada: false });
  });

  it("igual a lo guardado no se manda (con o sin el campo en el backend)", () => {
    const activa = { ...GUARDADA, propinaPreseleccionada: true };
    expect(cambiosParaGuardar(activa, formularioDesde(activa))).toEqual({});
    expect(cambiosParaGuardar(GUARDADA, formularioDesde(GUARDADA))).toEqual({});
  });

  it("avisa solo si está activa y el 10 % no está en los porcentajes sugeridos", () => {
    const activa = {
      ...formularioDesde(GUARDADA),
      propinaPreseleccionada: true,
    };

    // Con el 10 % en la lista: sin aviso.
    expect(avisoPreseleccion({ ...activa, propinas: "5, 10, 15" })).toBeNull();
    // Sin el 10 %, o con la lista vacía: aviso.
    expect(avisoPreseleccion({ ...activa, propinas: "5, 15" })).toMatch(
      /El 10 % no está en tus porcentajes sugeridos/,
    );
    expect(avisoPreseleccion({ ...activa, propinas: "" })).not.toBeNull();
    // Apagada: nunca avisa.
    expect(
      avisoPreseleccion({
        ...activa,
        propinaPreseleccionada: false,
        propinas: "5, 15",
      }),
    ).toBeNull();
  });

  it("si el campo de porcentajes tiene un error, no avisa (ya se ve el error del campo)", () => {
    expect(
      avisoPreseleccion({
        ...formularioDesde(GUARDADA),
        propinaPreseleccionada: true,
        propinas: "diez",
      }),
    ).toBeNull();
  });
});

describe("validaciones", () => {
  it("la razón social es obligatoria y tiene hasta 200 caracteres", () => {
    expect(errorRazonSocial("Uno SRL")).toBeNull();
    expect(errorRazonSocial("   ")).not.toBeNull();
    expect(errorRazonSocial("a".repeat(201))).not.toBeNull();
  });

  it("avisa si no queda ningún medio de pago habilitado", () => {
    const formulario = formularioDesde(GUARDADA);
    expect(sinMediosDePago(formulario)).toBe(false);
    expect(
      sinMediosDePago({
        ...formulario,
        efectivoHabilitado: false,
        mercadoPagoHabilitado: false,
        posHabilitado: false,
        plexoHabilitado: false,
      }),
    ).toBe(true);
    // HU-007b (BL-80): con el POS del local alcanza para cobrar.
    expect(
      sinMediosDePago({
        ...formulario,
        efectivoHabilitado: false,
        mercadoPagoHabilitado: false,
        posHabilitado: true,
      }),
    ).toBe(false);
  });
});

describe("HU-036 (BL-206): correo de privacidad", () => {
  it("es opcional: vacío vale; valida el formato y el largo", () => {
    expect(errorEmailPrivacidad("")).toBeNull();
    expect(errorEmailPrivacidad("  ")).toBeNull();
    expect(errorEmailPrivacidad("privacidad@uno.com.uy")).toBeNull();
    expect(errorEmailPrivacidad("privacidad@uno")).not.toBeNull();
    expect(errorEmailPrivacidad("no es un correo")).not.toBeNull();
    expect(errorEmailPrivacidad("a@@b.uy")).not.toBeNull();
    expect(errorEmailPrivacidad("@uno.com.uy")).not.toBeNull();
    expect(errorEmailPrivacidad("a@.uy")).not.toBeNull();
    expect(errorEmailPrivacidad("a@uno.")).not.toBeNull();
    expect(errorEmailPrivacidad(`${"a".repeat(250)}@b.uy`)).not.toBeNull();
  });

  it("manda el correo sin espacios y en minúsculas; vaciarlo manda null; igual al guardado no se manda", () => {
    const conCorreo = { ...GUARDADA, emailPrivacidad: "privacidad@uno.com.uy" };

    expect(
      cambiosParaGuardar(GUARDADA, {
        ...formularioDesde(GUARDADA),
        emailPrivacidad: " Privacidad@Uno.com.UY ",
      }),
    ).toEqual({ emailPrivacidad: "privacidad@uno.com.uy" });
    expect(
      cambiosParaGuardar(conCorreo, {
        ...formularioDesde(conCorreo),
        emailPrivacidad: "",
      }),
    ).toEqual({ emailPrivacidad: null });
    expect(cambiosParaGuardar(conCorreo, formularioDesde(conCorreo))).toEqual(
      {},
    );
    // Un backend anterior no trae el campo: vacío no es un cambio.
    expect(cambiosParaGuardar(GUARDADA, formularioDesde(GUARDADA))).toEqual({});
  });
});

describe("mensajeAnonimizacion (HU-009, BL-453)", () => {
  it("dice cuántos pedidos se anonimizaron, o que no había ninguno", () => {
    expect(mensajeAnonimizacion({ pedidos: 0 })).toMatch(/No hay pedidos/);
    expect(mensajeAnonimizacion({ pedidos: 1 })).toBe(
      "Listo: se anonimizó 1 pedido.",
    );
    expect(mensajeAnonimizacion({ pedidos: 3 })).toBe(
      "Listo: se anonimizaron 3 pedidos.",
    );
  });
});

describe("HU-042 (BL-465): cola del KDS", () => {
  const CON_COLA: ConfiguracionEstablecimiento = {
    ...GUARDADA,
    limitePedidosEnPreparacion: 5,
    umbralAlertaCola: 10,
    minutosPreparacionEstimados: 15,
  };

  it("[TC-U-407] el formulario arranca con la cola guardada", () => {
    expect(formularioDesde(CON_COLA)).toEqual(
      expect.objectContaining({
        colaActiva: true,
        limitePreparacion: "5",
        umbralAlertaCola: "10",
        minutosPreparacion: "15",
      }),
    );
    expect(
      formularioDesde({ ...CON_COLA, limitePedidosEnPreparacion: null })
        .colaActiva,
    ).toBe(false);
  });

  it("[TC-U-408] activar la cola manda el límite; cambiar el umbral o los minutos manda solo eso", () => {
    expect(
      cambiosParaGuardar(GUARDADA, {
        ...formularioDesde(GUARDADA),
        colaActiva: true,
        limitePreparacion: "4",
      }),
    ).toEqual({ limitePedidosEnPreparacion: 4 });

    expect(
      cambiosParaGuardar(CON_COLA, {
        ...formularioDesde(CON_COLA),
        umbralAlertaCola: " 8 ",
        minutosPreparacion: "20",
      }),
    ).toEqual({ umbralAlertaCola: 8, minutosPreparacionEstimados: 20 });
  });

  it("[TC-U-409] apagar la cola manda el límite en null y no toca el umbral ni los minutos", () => {
    expect(
      cambiosParaGuardar(CON_COLA, {
        ...formularioDesde(CON_COLA),
        colaActiva: false,
        umbralAlertaCola: "99",
      }),
    ).toEqual({ limitePedidosEnPreparacion: null });
  });

  it("[TC-U-410] con la cola apagada y sin guardar, no hay nada que mandar", () => {
    const cambios = cambiosParaGuardar(GUARDADA, formularioDesde(GUARDADA));
    expect(hayCambios(cambios)).toBe(false);
  });

  it("[TC-U-411] valida enteros dentro de rango, solo con la cola activa", () => {
    const formulario = { ...formularioDesde(CON_COLA) };
    expect(hayErroresCola(erroresCola(formulario))).toBe(false);

    expect(
      erroresCola({
        ...formulario,
        limitePreparacion: "0",
        umbralAlertaCola: "2.5",
        minutosPreparacion: "181",
      }),
    ).toEqual({
      limitePreparacion: "Tiene que estar entre 1 y 50.",
      umbralAlertaCola: "Escribí un número entero.",
      minutosPreparacion: "Tiene que estar entre 1 y 180.",
    });

    expect(
      erroresCola({ ...formulario, colaActiva: false, limitePreparacion: "" }),
    ).toEqual({});
  });
});

describe("primerCampoConError", () => {
  const SIN_ERRORES = {
    razonSocial: null,
    nombreLocal: null,
    direccionLocal: null,
    propinas: null,
    cola: {},
    email: null,
    retiro: null,
  };

  it("[TC-U-422] devuelve el primer campo con error en el orden de la pantalla, o null", () => {
    expect(primerCampoConError(SIN_ERRORES)).toBeNull();
    expect(
      primerCampoConError({
        ...SIN_ERRORES,
        email: "mal",
        cola: { umbralAlertaCola: "mal" },
      }),
    ).toBe("cola-umbral");
    expect(
      primerCampoConError({
        ...SIN_ERRORES,
        propinas: "mal",
        cola: { limitePreparacion: "mal" },
      }),
    ).toBe("propinas");
    expect(primerCampoConError({ ...SIN_ERRORES, email: "mal" })).toBe(
      "email-privacidad",
    );
    expect(
      primerCampoConError({ ...SIN_ERRORES, email: "mal", retiro: "mal" }),
    ).toBe("retiro-desde");
  });
});

describe("erroresDelFormulario", () => {
  it("[TC-U-423] junta los errores de todos los campos; sin formulario no hay errores", () => {
    expect(erroresDelFormulario(null)).toEqual({
      razonSocial: null,
      nombreLocal: null,
      direccionLocal: null,
      propinas: null,
      email: null,
      cola: {},
      retiro: null,
    });

    expect(
      erroresDelFormulario({
        ...formularioDesde(GUARDADA),
        razonSocial: "   ",
        propinas: "diez",
        emailPrivacidad: "no-es-un-correo",
        colaActiva: true,
        limitePreparacion: "0",
        retiroHoraDesde: "11:00",
      }),
    ).toEqual({
      razonSocial: "La razón social es obligatoria.",
      nombreLocal: null,
      direccionLocal: null,
      propinas: expect.any(String),
      email: expect.any(String),
      cola: { limitePreparacion: "Tiene que estar entre 1 y 50." },
      retiro: expect.any(String),
    });

    expect(erroresDelFormulario(formularioDesde(GUARDADA))).toEqual({
      razonSocial: null,
      nombreLocal: null,
      direccionLocal: null,
      propinas: null,
      email: null,
      cola: {},
      retiro: null,
    });
  });
});

describe("HU-040 (BL-210): pedidos para retirar", () => {
  const horario = (retiroHoraDesde: string, retiroHoraHasta: string) => ({
    retiroHoraDesde,
    retiroHoraHasta,
  });

  it("el horario: las dos vacías (todo el día) o las dos, válidas y distintas", () => {
    expect(errorHorarioRetiro(horario("", ""))).toBeNull();
    expect(errorHorarioRetiro(horario("11:00", "15:30"))).toBeNull();
    // Cruza la medianoche.
    expect(errorHorarioRetiro(horario("19:00", "01:00"))).toBeNull();
    expect(errorHorarioRetiro(horario("11:00", ""))).toBe(
      "Completá las dos horas, o dejá las dos vacías para tomar pedidos todo el día.",
    );
    expect(errorHorarioRetiro(horario("", "15:00"))).not.toBeNull();
    expect(errorHorarioRetiro(horario("24:00", "15:00"))).toBe(
      "Escribí las horas como 11:00 o 23:30.",
    );
    expect(errorHorarioRetiro(horario("9:00", "15:00"))).not.toBeNull();
    expect(errorHorarioRetiro(horario("12:00", "12:00"))).toBe(
      "La hora de inicio y la de cierre tienen que ser distintas.",
    );
  });

  it("se lee de lo guardado y solo se manda lo que cambió; las horas van juntas", () => {
    const guardada: ConfiguracionEstablecimiento = {
      ...GUARDADA,
      retiroHabilitado: true,
      retiroHoraDesde: "11:00",
      retiroHoraHasta: "15:00",
    };
    const formulario = formularioDesde(guardada);
    expect(formulario).toMatchObject({
      retiroHabilitado: true,
      retiroHoraDesde: "11:00",
      retiroHoraHasta: "15:00",
    });
    expect(cambiosParaGuardar(guardada, formulario)).toEqual({});
    expect(
      cambiosParaGuardar(guardada, { ...formulario, retiroHabilitado: false }),
    ).toEqual({ retiroHabilitado: false });
    expect(
      cambiosParaGuardar(guardada, { ...formulario, retiroHoraHasta: "16:00" }),
    ).toEqual({ retiroHoraDesde: "11:00", retiroHoraHasta: "16:00" });
    // Vaciar las dos = todo el día.
    expect(
      cambiosParaGuardar(guardada, {
        ...formulario,
        retiroHoraDesde: "",
        retiroHoraHasta: " ",
      }),
    ).toEqual({ retiroHoraDesde: null, retiroHoraHasta: null });
  });

  it("mensaje después de anonimizar el contacto", () => {
    expect(mensajeAnonimizacionRetiro({ pedidos: 0 })).toBe(
      "No hay pedidos con ese contacto: no había datos para anonimizar.",
    );
    expect(mensajeAnonimizacionRetiro({ pedidos: 1 })).toBe(
      "Listo: se anonimizó 1 pedido.",
    );
    expect(mensajeAnonimizacionRetiro({ pedidos: 4 })).toBe(
      "Listo: se anonimizaron 4 pedidos.",
    );
  });
});

describe("HU-038 (BL-506): umbrales de espera del KDS", () => {
  const CON_UMBRALES: ConfiguracionEstablecimiento = {
    ...GUARDADA,
    minutosEsperaAtencion: 20,
    minutosEsperaDemorado: 40,
    minutosEsperaDemoraAlta: 90,
  };

  it("[TC-U-479] el formulario arranca con los umbrales guardados, o con 30/60/120 si el backend no los trae", () => {
    expect(formularioDesde(CON_UMBRALES)).toEqual(
      expect.objectContaining({
        esperaAtencion: "20",
        esperaDemorado: "40",
        esperaDemoraAlta: "90",
      }),
    );
    expect(formularioDesde(GUARDADA)).toEqual(
      expect.objectContaining({
        esperaAtencion: "30",
        esperaDemorado: "60",
        esperaDemoraAlta: "120",
      }),
    );
  });

  it("[TC-U-480] manda solo los umbrales que cambiaron, con la cola activa o apagada", () => {
    expect(
      cambiosParaGuardar(CON_UMBRALES, {
        ...formularioDesde(CON_UMBRALES),
        esperaDemorado: " 45 ",
      }),
    ).toEqual({ minutosEsperaDemorado: 45 });
    expect(cambiosParaGuardar(GUARDADA, formularioDesde(GUARDADA))).toEqual({});
  });

  it("[TC-U-481] valida enteros dentro de rango y de menor a mayor, aunque la cola esté apagada", () => {
    const formulario = { ...formularioDesde(GUARDADA), colaActiva: false };
    expect(erroresCola(formulario)).toEqual({});
    expect(
      erroresCola({
        ...formulario,
        esperaAtencion: "0",
        esperaDemoraAlta: "x",
      }),
    ).toEqual({
      esperaAtencion: "Tiene que estar entre 1 y 600.",
      esperaDemoraAlta: "Escribí un número entero.",
    });
    expect(erroresCola({ ...formulario, esperaDemorado: "30" })).toEqual({
      esperaDemorado: "Tiene que ser mayor que «Atención desde».",
    });
    expect(erroresCola({ ...formulario, esperaDemoraAlta: "60" })).toEqual({
      esperaDemoraAlta: "Tiene que ser mayor que «Demorado desde».",
    });
  });

  it("[TC-U-482] el foco va al primer umbral con error, después de los campos de la cola", () => {
    expect(
      primerCampoConError({
        razonSocial: null,
        nombreLocal: null,
        direccionLocal: null,
        propinas: null,
        email: "mal",
        cola: { esperaDemorado: "mal" },
        retiro: null,
      }),
    ).toBe("espera-demorado");
    expect(
      primerCampoConError({
        razonSocial: null,
        nombreLocal: null,
        direccionLocal: null,
        propinas: null,
        email: null,
        cola: { minutosPreparacion: "mal", esperaAtencion: "mal" },
        retiro: null,
      }),
    ).toBe("cola-minutos");
  });
});
describe("HU-043 (BL-533): marca del local", () => {
  const CON_MARCA: ConfiguracionEstablecimiento = {
    ...GUARDADA,
    plantilla: "gourmet",
    plantillasDisponibles: ["clasica", "gourmet", "rapida", "familiar"],
    logoUrl: "https://firmada.example/logo.webp",
  };

  it("[TC-U-524] el formulario arranca con la plantilla guardada y el logo sin tocar", () => {
    const formulario = formularioDesde(CON_MARCA);

    expect(formulario.plantilla).toBe("gourmet");
    expect(formulario.logo).toEqual({ tipo: "guardado" });
    expect(cambiosParaGuardar(CON_MARCA, formulario)).toEqual({});
  });

  it("[TC-U-525] cambiar la plantilla manda solo la plantilla", () => {
    const formulario = {
      ...formularioDesde(CON_MARCA),
      plantilla: "rapida" as const,
    };

    expect(cambiosParaGuardar(CON_MARCA, formulario)).toEqual({
      plantilla: "rapida",
    });
  });

  it("[TC-U-526] un logo nuevo manda su key; quitarlo manda null solo si había uno guardado", () => {
    const key =
      "11111111-1111-1111-1111-111111111111/menu/marca/0b4f6a3e-1111-4c2d-9e8f-123456789abc.webp";
    const nuevo = {
      ...formularioDesde(CON_MARCA),
      logo: {
        tipo: "nuevo" as const,
        key,
        url: "https://firmada.example/nuevo.webp",
      },
    };
    expect(cambiosParaGuardar(CON_MARCA, nuevo)).toEqual({ logoKey: key });

    const quitado = {
      ...formularioDesde(CON_MARCA),
      logo: { tipo: "quitado" as const },
    };
    expect(cambiosParaGuardar(CON_MARCA, quitado)).toEqual({ logoKey: null });

    const sinLogo = { ...CON_MARCA, logoUrl: null };
    expect(
      cambiosParaGuardar(sinLogo, {
        ...formularioDesde(sinLogo),
        logo: { tipo: "quitado" },
      }),
    ).toEqual({});
  });

  it("[TC-U-527] la vista previa muestra el logo nuevo, ninguno si se quitó, o el guardado", () => {
    expect(urlDelLogo(CON_MARCA, { tipo: "guardado" })).toBe(
      "https://firmada.example/logo.webp",
    );
    expect(
      urlDelLogo(CON_MARCA, {
        tipo: "nuevo",
        key: "k",
        url: "https://firmada.example/nuevo.webp",
      }),
    ).toBe("https://firmada.example/nuevo.webp");
    expect(urlDelLogo(CON_MARCA, { tipo: "quitado" })).toBeNull();
    expect(urlDelLogo(GUARDADA, { tipo: "guardado" })).toBeNull();
  });
});

describe("HU-043 (BL-561): nombre y dirección del local", () => {
  const CON_LOCAL: ConfiguracionEstablecimiento = {
    ...GUARDADA,
    nombre: "La Parrilla",
    direccion: "Av. Italia 1234, Montevideo",
  };

  it("[TC-U-539] el formulario arranca con lo guardado y, sin cambios, no manda nada", () => {
    const formulario = formularioDesde(CON_LOCAL);

    expect(formulario.nombreLocal).toBe("La Parrilla");
    expect(formulario.direccionLocal).toBe("Av. Italia 1234, Montevideo");
    expect(
      cambiosParaGuardar(CON_LOCAL, {
        ...formulario,
        nombreLocal: "  La   Parrilla ",
      }),
    ).toEqual({});
  });

  it("[TC-U-540] manda el nombre y la dirección limpios, solo si cambiaron", () => {
    const formulario = {
      ...formularioDesde(CON_LOCAL),
      nombreLocal: " La Parrilla  de Juan ",
      direccionLocal: "18 de Julio 1234",
    };

    expect(cambiosParaGuardar(CON_LOCAL, formulario)).toEqual({
      nombre: "La Parrilla de Juan",
      direccion: "18 de Julio 1234",
    });
  });

  it("[TC-U-541] los dos son obligatorios y tienen largo máximo; sin backend que los traiga, no se validan", () => {
    expect(errorNombreLocal("   ")).toBe("El nombre del local es obligatorio.");
    expect(errorNombreLocal("x".repeat(121))).toMatch(/hasta 120/);
    expect(errorNombreLocal("La Parrilla")).toBeNull();
    expect(errorDireccionLocal("")).toBe(
      "La dirección del local es obligatoria.",
    );
    expect(errorDireccionLocal("x".repeat(201))).toMatch(/hasta 200/);
    expect(errorNombreLocal(null)).toBeNull();
    expect(errorDireccionLocal(null)).toBeNull();
  });

  it("[TC-U-542] el foco va al nombre o a la dirección después de las propinas y antes de la cola", () => {
    const errores = erroresDelFormulario({
      ...formularioDesde(CON_LOCAL),
      direccionLocal: "",
      colaActiva: true,
      limitePreparacion: "0",
    });

    expect(primerCampoConError(errores)).toBe("direccion-local");
  });
});
