import {
  cambiosParaGuardar,
  errorEmailPrivacidad,
  errorRazonSocial,
  erroresCola,
  erroresDelFormulario,
  formularioDesde,
  hayErroresCola,
  primerCampoConError,
  hayCambios,
  leerPropinas,
  sinMediosDePago,
  type ConfiguracionEstablecimiento,
  mensajeAnonimizacion,
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
      efectivoHabilitado: true,
      mercadoPagoHabilitado: true,
      // HU-007b (BL-80): un backend anterior no lo trae: el default (true).
      posHabilitado: true,
      plexoHabilitado: false,
      handyHabilitado: false,
      propinas: "10, 15",
      cfeProveedor: "SURTEC",
      emailPrivacidad: "",
      // HU-042 (BL-465): un backend anterior no trae la cola: desactivada,
      // con los valores que la pantalla propone al activarla.
      colaActiva: false,
      limitePreparacion: "5",
      umbralAlertaCola: "10",
      minutosPreparacion: "15",
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
    propinas: null,
    cola: {},
    email: null,
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
  });
});

describe("erroresDelFormulario", () => {
  it("[TC-U-423] junta los errores de todos los campos; sin formulario no hay errores", () => {
    expect(erroresDelFormulario(null)).toEqual({
      razonSocial: null,
      propinas: null,
      email: null,
      cola: {},
    });

    expect(
      erroresDelFormulario({
        ...formularioDesde(GUARDADA),
        razonSocial: "   ",
        propinas: "diez",
        emailPrivacidad: "no-es-un-correo",
        colaActiva: true,
        limitePreparacion: "0",
      }),
    ).toEqual({
      razonSocial: "La razón social es obligatoria.",
      propinas: expect.any(String),
      email: expect.any(String),
      cola: { limitePreparacion: "Tiene que estar entre 1 y 50." },
    });

    expect(erroresDelFormulario(formularioDesde(GUARDADA))).toEqual({
      razonSocial: null,
      propinas: null,
      email: null,
      cola: {},
    });
  });
});
