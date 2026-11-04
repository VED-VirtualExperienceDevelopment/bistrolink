import {
  cambiosParaGuardar,
  errorEmailPrivacidad,
  errorRazonSocial,
  formularioDesde,
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
      plexoHabilitado: false,
      handyHabilitado: false,
      propinas: "10, 15",
      cfeProveedor: "SURTEC",
      emailPrivacidad: "",
    });
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
        plexoHabilitado: false,
      }),
    ).toBe(true);
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
