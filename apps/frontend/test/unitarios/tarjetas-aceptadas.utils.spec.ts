import {
  estadoDeTarjeta,
  marcaDelMedio,
  tarjetasDeLaRespuesta,
  textoTarjeta,
} from "@/components/pago/tarjetas-aceptadas.utils";

/** HU-051 (BL-563): sello de pago seguro. */

const visa = {
  id: "visa",
  nombre: "Visa",
  imagen: "https://http2.mlstatic.com/visa.gif",
  credito: true,
  debito: true,
};

describe("tarjetasDeLaRespuesta", () => {
  it("respeta el orden de la API, sin repetidos", () => {
    expect(
      tarjetasDeLaRespuesta({
        tarjetas: [
          visa,
          { ...visa, id: "oca", nombre: "OCA", debito: false },
          { ...visa, nombre: "Visa repetida" },
        ],
      }).map((t) => t.nombre),
    ).toEqual(["Visa", "OCA"]);
  });

  it("descarta lo que no tiene forma y las imágenes que no son HTTPS", () => {
    expect(
      tarjetasDeLaRespuesta({
        tarjetas: [
          null,
          { id: "", nombre: "Vacía", imagen: null },
          { id: 3, nombre: "Número", imagen: null },
          { id: "lider", nombre: "Líder", imagen: "http://x/lider.gif" },
        ],
      }),
    ).toEqual([
      {
        id: "lider",
        nombre: "Líder",
        imagen: null,
        credito: false,
        debito: false,
      },
    ]);
  });

  it.each([[null], ["texto"], [{}], [{ tarjetas: "visa" }]])(
    "una respuesta inesperada (%p) da una lista vacía",
    (cuerpo) => {
      expect(tarjetasDeLaRespuesta(cuerpo)).toEqual([]);
    },
  );
});

describe("marca detectada", () => {
  it("la marca sale del medio de pago que detectó Mercado Pago", () => {
    expect(marcaDelMedio("debvisa")).toBe("visa");
    expect(marcaDelMedio("master")).toBe("master");
    expect(marcaDelMedio(undefined)).toBeNull();
    expect(marcaDelMedio("")).toBeNull();
  });

  it("resalta la detectada y atenúa las demás; sin marca, todas iguales", () => {
    expect(estadoDeTarjeta(visa, null)).toBe("normal");
    expect(estadoDeTarjeta(visa, "visa")).toBe("detectada");
    expect(estadoDeTarjeta(visa, "master")).toBe("atenuada");
  });
});

describe("textoTarjeta", () => {
  it("dice si es de crédito, de débito o de las dos", () => {
    expect(textoTarjeta(visa)).toBe("Visa (crédito y débito)");
    expect(textoTarjeta({ ...visa, credito: false })).toBe("Visa (débito)");
    expect(textoTarjeta({ ...visa, debito: false })).toBe("Visa");
  });
});
