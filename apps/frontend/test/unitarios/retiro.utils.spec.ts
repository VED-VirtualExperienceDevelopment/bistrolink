import {
  avisoRetiroCerrado,
  contactoParaEnviar,
  CONTACTO_RETIRO_VACIO,
  errorContactoRetiro,
  firmaContactoRetiro,
  lugarDelPedido,
  normalizarCodigoRetiro,
  normalizarContactoRetiro,
  permisoDeAviso,
  repartirErrorDelPedido,
  rutaEntregarRetiro,
  textoAvisoListo,
} from "@/components/retiro/retiro.utils";

// HU-040 (BL-210): pedidos para retirar por el enlace web.

describe("avisoRetiroCerrado", () => {
  const retiro = {
    habilitado: true,
    abierto: true,
    horaDesde: null,
    horaHasta: null,
  };

  it("abierto o sin dato del backend: se puede pedir", () => {
    expect(avisoRetiroCerrado(retiro)).toBeNull();
    expect(avisoRetiroCerrado(undefined)).toBeNull();
    expect(avisoRetiroCerrado(null)).toBeNull();
  });

  it("deshabilitado o fuera del horario: dice por qué", () => {
    expect(
      avisoRetiroCerrado({ ...retiro, habilitado: false, abierto: false }),
    ).toBe("Este local no está tomando pedidos para retirar en este momento.");
    expect(
      avisoRetiroCerrado({
        ...retiro,
        abierto: false,
        horaDesde: "11:00",
        horaHasta: "15:00",
      }),
    ).toBe(
      "Este local toma pedidos para retirar de 11:00 a 15:00. Podés ver la carta, pero todavía no pedir.",
    );
    expect(avisoRetiroCerrado({ ...retiro, abierto: false })).toBe(
      "Este local no está tomando pedidos para retirar en este momento.",
    );
  });
});

describe("contacto del comensal", () => {
  const completo = {
    nombre: " Ana ",
    contacto: " 099 123 456 ",
    consentimiento: true,
  };

  it("vacío es válido y no se manda nada", () => {
    expect(errorContactoRetiro(CONTACTO_RETIRO_VACIO)).toBeNull();
    expect(contactoParaEnviar(CONTACTO_RETIRO_VACIO)).toBeUndefined();
    expect(firmaContactoRetiro(undefined)).toBe("");
  });

  it("completo y con consentimiento: se manda sin espacios de más", () => {
    expect(errorContactoRetiro(completo)).toBeNull();
    const enviado = contactoParaEnviar(completo);
    expect(enviado).toEqual({
      nombre: "Ana",
      contacto: "099 123 456",
      consentimiento: true,
    });
    expect(firmaContactoRetiro(enviado)).toBe("|Ana|099 123 456");
  });

  it("a medias o sin consentimiento: error y no se manda", () => {
    expect(errorContactoRetiro({ ...completo, nombre: "" })).toBe(
      "Escribí tu nombre o dejá los dos campos vacíos.",
    );
    expect(errorContactoRetiro({ ...completo, contacto: "" })).toBe(
      "Escribí un teléfono o un correo, o dejá los dos campos vacíos.",
    );
    // Sin dígitos ni arroba, el backend no guardaría nada.
    expect(
      errorContactoRetiro({ ...completo, contacto: "abc" }),
    ).not.toBeNull();
    expect(errorContactoRetiro({ ...completo, nombre: "x".repeat(61) })).toBe(
      "El nombre puede tener hasta 60 caracteres.",
    );
    expect(
      errorContactoRetiro({ ...completo, contacto: "1".repeat(101) }),
    ).toBe("El contacto puede tener hasta 100 caracteres.");
    expect(errorContactoRetiro({ ...completo, consentimiento: false })).toBe(
      "Para guardar tu nombre y tu contacto, marcá que estás de acuerdo.",
    );
    expect(
      contactoParaEnviar({ ...completo, consentimiento: false }),
    ).toBeUndefined();
  });

  it("normaliza como el backend: correo en minúsculas, teléfono solo dígitos", () => {
    expect(normalizarContactoRetiro(" Ana@Correo.UY ")).toBe("ana@correo.uy");
    expect(normalizarContactoRetiro("+598 99-123-456")).toBe("+59899123456");
    expect(normalizarContactoRetiro("099 123 456")).toBe("099123456");
  });
});

describe("código de retiro", () => {
  it("acepta lo que escribe el colaborador y lo lleva a R-NNN", () => {
    for (const texto of ["R-042", "r42", " R 042 ", "42", "r-42", "042"]) {
      expect(normalizarCodigoRetiro(texto)).toBe("R-042");
    }
    expect(normalizarCodigoRetiro("R-999")).toBe("R-999");
  });

  it("rechaza lo que no tiene esa forma", () => {
    for (const texto of ["", "R-", "X-042", "1000", "0", "R-0420", "abc"]) {
      expect(normalizarCodigoRetiro(texto)).toBeNull();
    }
  });

  it("ruta de la entrega", () => {
    expect(rutaEntregarRetiro("p-1")).toBe("/pedidos/p-1/entregar-retiro");
  });
});

describe("KDS y aviso al comensal", () => {
  it("la comanda dice para retirar con el código, o la mesa", () => {
    expect(lugarDelPedido({ mesaNumero: 0, retiro: { codigo: "R-042" } })).toBe(
      "Para retirar · R-042",
    );
    expect(lugarDelPedido({ mesaNumero: 3, retiro: null })).toBe("Mesa 3");
    expect(lugarDelPedido({ mesaNumero: 3 })).toBe("Mesa 3");
  });

  it("texto de la notificación, con o sin código", () => {
    expect(textoAvisoListo("R-042")).toEqual({
      titulo: "Tu pedido está listo",
      cuerpo: "Retiralo en el mostrador con el código R-042.",
    });
    expect(textoAvisoListo(null).cuerpo).toBe("Retiralo en el mostrador.");
  });

  it("permiso de notificaciones del navegador", () => {
    expect(permisoDeAviso(undefined)).toBe("no-soportado");
    expect(permisoDeAviso({})).toBe("no-soportado");
    expect(permisoDeAviso({ Notification: { permission: "granted" } })).toBe(
      "granted",
    );
    expect(permisoDeAviso({ Notification: { permission: "default" } })).toBe(
      "default",
    );
    expect(permisoDeAviso({ Notification: { permission: "denied" } })).toBe(
      "denied",
    );
    expect(permisoDeAviso({ Notification: { permission: "raro" } })).toBe(
      "no-soportado",
    );
  });
});

describe("repartirErrorDelPedido", () => {
  const errorContacto = "Escribí tu nombre";

  it("el error del contacto va al formulario, no al carrito", () => {
    expect(repartirErrorDelPedido(errorContacto, errorContacto)).toEqual({
      delContacto: errorContacto,
      delCarrito: null,
    });
  });

  it("otro error va al carrito", () => {
    expect(
      repartirErrorDelPedido("No pudimos enviar tu pedido.", errorContacto),
    ).toEqual({
      delContacto: null,
      delCarrito: "No pudimos enviar tu pedido.",
    });
  });

  it("sin error, nada en ningún lado", () => {
    expect(repartirErrorDelPedido(null, errorContacto)).toEqual({
      delContacto: null,
      delCarrito: null,
    });
    expect(repartirErrorDelPedido(null, null)).toEqual({
      delContacto: null,
      delCarrito: null,
    });
  });
});
