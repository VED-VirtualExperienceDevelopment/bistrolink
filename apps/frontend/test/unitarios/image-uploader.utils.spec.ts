import {
  ErrorConfirmacionImagen,
  ErrorSubidaAlmacenamiento,
  MENSAJE_DEMASIADOS_INTENTOS,
  MENSAJE_FORMATO_NO_PERMITIDO,
  MENSAJE_TAMANIO_EXCEDIDO,
  mensajeErrorSubida,
  TAMANIO_MAXIMO_IMAGEN,
  validarImagen,
} from "@/components/menu/image-uploader.utils";

// BL-257: un archivo de más de 5 MB o de otro tipo se rechaza con un mensaje
// claro, y cada falla de la subida muestra un mensaje real (no "WIP").
// BL-54: el backend también rechaza (400 formato, 413 tamaño) y S3 responde
// 400 cuando la policy rechaza el tamaño.

describe("validarImagen", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])(
    "acepta %s de hasta 5 MB",
    (type) => {
      expect(validarImagen({ type, size: TAMANIO_MAXIMO_IMAGEN })).toBeNull();
    },
  );

  it.each(["image/gif", "image/svg+xml", "image/heic", "application/pdf", ""])(
    "rechaza el tipo %p",
    (type) => {
      expect(validarImagen({ type, size: 1024 })).toBe(
        "Formato no permitido. Usá una imagen PNG, JPG o WEBP.",
      );
    },
  );

  it("rechaza 1 byte por encima de 5 MB, indicando el peso", () => {
    expect(
      validarImagen({ type: "image/png", size: TAMANIO_MAXIMO_IMAGEN + 1 }),
    ).toBe("La imagen pesa 5 MB. El máximo es 5 MB.");
  });

  it("muestra el peso con un decimal", () => {
    expect(validarImagen({ type: "image/jpeg", size: 7.5 * 1024 * 1024 })).toBe(
      "La imagen pesa 7,5 MB. El máximo es 5 MB.",
    );
  });

  it("valida el tipo antes que el tamaño", () => {
    expect(validarImagen({ type: "image/gif", size: 10 * 1024 * 1024 })).toBe(
      "Formato no permitido. Usá una imagen PNG, JPG o WEBP.",
    );
  });
});

describe("mensajeErrorSubida", () => {
  it("S3 responde 403 (la policy rechazó el archivo)", () => {
    expect(mensajeErrorSubida(new ErrorSubidaAlmacenamiento(403))).toBe(
      "El almacenamiento rechazó la imagen. Verificá que sea PNG, JPG o WEBP de hasta 5 MB.",
    );
  });

  // BL-54: S3 responde 400 (EntityTooLarge) cuando el archivo supera el
  // content-length-range de la policy.
  it("S3 responde 400 (la policy rechazó el tamaño)", () => {
    expect(mensajeErrorSubida(new ErrorSubidaAlmacenamiento(400))).toBe(
      "El almacenamiento rechazó la imagen. Verificá que sea PNG, JPG o WEBP de hasta 5 MB.",
    );
  });

  it("S3 responde otro error", () => {
    expect(mensajeErrorSubida(new ErrorSubidaAlmacenamiento(500))).toBe(
      "No pudimos guardar la imagen. Probá de nuevo.",
    );
  });

  it("sin respuesta de S3 (red o CORS: fetch tira TypeError)", () => {
    expect(mensajeErrorSubida(new TypeError("Failed to fetch"))).toBe(
      "No pudimos conectar con el almacenamiento de imágenes. Revisá tu conexión y probá de nuevo.",
    );
  });

  // BL-54: el backend rechaza imágenes de más de 5 MB con 413.
  it("el backend responde 413 (imagen demasiado grande)", () => {
    expect(mensajeErrorSubida({ status: 413, message: "x" })).toBe(
      MENSAJE_TAMANIO_EXCEDIDO,
    );
  });

  // BL-54: el backend rechaza tipos fuera de jpeg/png/webp con 400.
  it("el backend responde 400 (formato no permitido)", () => {
    expect(mensajeErrorSubida({ status: 400, message: "x" })).toBe(
      MENSAJE_FORMATO_NO_PERMITIDO,
    );
  });

  it.each([401, 403])(
    "el backend rechaza la URL firmada con %p (sesión o permisos)",
    (status) => {
      expect(mensajeErrorSubida({ status, message: "x" })).toBe(
        "Tu sesión expiró o no tenés permisos para subir imágenes. Volvé a iniciar sesión.",
      );
    },
  );

  it("el backend falla al generar la URL firmada", () => {
    expect(mensajeErrorSubida({ status: 500, message: "x" })).toBe(
      "No pudimos preparar la subida. Probá de nuevo en unos minutos.",
    );
  });

  it.each([new Error("otra cosa"), "texto", null])(
    "cualquier otro error (%p): mensaje genérico",
    (err) => {
      expect(mensajeErrorSubida(err)).toBe(
        "No pudimos subir la imagen. Probá de nuevo.",
      );
    },
  );
});

// BL-388: la confirmación (la API verifica y reprocesa la imagen) muestra el
// motivo que redacta la API, y el límite de pedidos tiene su propio mensaje.
describe("mensajeErrorSubida: confirmación de la imagen", () => {
  const confirmacion = (status: number, message = "Motivo de la API") =>
    new ErrorConfirmacionImagen({ status, message });

  it.each([400, 404, 413])(
    "la API rechaza la imagen con %p: muestra el motivo de la API",
    (status) => {
      expect(
        mensajeErrorSubida(
          confirmacion(status, "El archivo no es una imagen válida"),
        ),
      ).toBe("El archivo no es una imagen válida");
    },
  );

  it("la API responde 429 al confirmar", () => {
    expect(mensajeErrorSubida(confirmacion(429))).toBe(
      MENSAJE_DEMASIADOS_INTENTOS,
    );
  });

  it.each([401, 403])("la API responde %p al confirmar", (status) => {
    expect(mensajeErrorSubida(confirmacion(status))).toBe(
      "Tu sesión expiró o no tenés permisos para subir imágenes. Volvé a iniciar sesión.",
    );
  });

  it("la API falla al confirmar (500)", () => {
    expect(mensajeErrorSubida(confirmacion(500))).toBe(
      "No pudimos procesar la imagen. Probá de nuevo.",
    );
  });

  it("falla sin respuesta al confirmar (sin status)", () => {
    expect(
      mensajeErrorSubida(new ErrorConfirmacionImagen(new TypeError("red"))),
    ).toBe("No pudimos procesar la imagen. Probá de nuevo.");
  });

  it("la API responde 429 al pedir la URL firmada", () => {
    expect(mensajeErrorSubida({ status: 429, message: "x" })).toBe(
      MENSAJE_DEMASIADOS_INTENTOS,
    );
  });
});
