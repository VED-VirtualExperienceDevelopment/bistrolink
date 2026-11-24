import {
  TEXTO_ESTADO_CONEXION,
  esperaConexion,
  siguienteEstadoConexion,
  type EstadoConexion,
  type EventoConexion,
} from "@/components/conexion/estado-conexion.utils";

// HU-038 (BL-504): estado de la conexión en tiempo real.

/** Aplica los eventos en orden desde el estado inicial. */
function recorrer(eventos: EventoConexion[]): EstadoConexion {
  return eventos.reduce<EstadoConexion>(siguienteEstadoConexion, "conectando");
}

describe("siguienteEstadoConexion", () => {
  it("[TC-U-484] arranca conectando y pasa a conectado al conectar", () => {
    expect(recorrer([])).toBe("conectando");
    expect(recorrer(["conectado"])).toBe("conectado");
  });

  it("[TC-U-485] si se corta, reconectando; al volver, conectado", () => {
    expect(recorrer(["conectado", "perdido"])).toBe("reconectando");
    expect(recorrer(["conectado", "perdido", "perdido"])).toBe("reconectando");
    expect(recorrer(["conectado", "perdido", "conectado"])).toBe("conectado");
  });

  it("[TC-U-486] pasada la demora sin conexión, desconectado; vuelve a conectado si reconecta", () => {
    expect(recorrer(["conectado", "perdido", "demora-vencida"])).toBe(
      "desconectado",
    );
    expect(
      recorrer(["conectado", "perdido", "demora-vencida", "perdido"]),
    ).toBe("desconectado");
    expect(
      recorrer(["conectado", "perdido", "demora-vencida", "conectado"]),
    ).toBe("conectado");
  });

  it("[TC-U-487] la primera conexión que nunca llega también termina en desconectado (no queda cargando)", () => {
    expect(recorrer(["perdido"])).toBe("conectando");
    expect(recorrer(["perdido", "demora-vencida"])).toBe("desconectado");
  });

  it("[TC-U-488] sin red, desconectado enseguida; al volver la red, reconectando hasta que conecte", () => {
    expect(recorrer(["conectado", "sin-red"])).toBe("desconectado");
    expect(recorrer(["conectado", "sin-red", "con-red"])).toBe("reconectando");
    expect(recorrer(["conectado", "sin-red", "con-red", "conectado"])).toBe(
      "conectado",
    );
    // Volver la red estando conectado no cambia nada.
    expect(recorrer(["conectado", "con-red"])).toBe("conectado");
  });

  it("[TC-U-489] la demora vencida no afecta a una conexión que ya volvió", () => {
    expect(recorrer(["conectado", "demora-vencida"])).toBe("conectado");
  });
});

describe("esperaConexion", () => {
  it("[TC-U-490] solo cuenta la demora mientras espera conectar", () => {
    expect(esperaConexion("conectando")).toBe(true);
    expect(esperaConexion("reconectando")).toBe(true);
    expect(esperaConexion("conectado")).toBe(false);
    expect(esperaConexion("desconectado")).toBe(false);
  });
});

describe("TEXTO_ESTADO_CONEXION", () => {
  it("[TC-U-491] cada estado tiene su texto (no solo color)", () => {
    expect(TEXTO_ESTADO_CONEXION).toEqual({
      conectando: "Conectando…",
      conectado: "Conectado",
      reconectando: "Reconectando…",
      desconectado: "Desconectado",
    });
  });
});
