import {
  NOMBRE_APP_FARO,
  configuracionFaro,
  redactarRuta,
  redactarTexto,
  redactarUrl,
  sanearItem,
} from "@/lib/observabilidad/faro";

// BL-214: errores del navegador en Grafana Cloud (Faro), sin tokens ni
// datos personales en lo que se manda.

const COLECTOR =
  "https://faro-collector-prod-us-east-0.grafana.net/collect/abc123";
// Valor de prueba con forma de código de QR (no es un secreto real).
const QR_PRUEBA = "qr-de-prueba";

describe("configuracionFaro (BL-214)", () => {
  it("no inicializa sin URL del colector (local y tests)", () => {
    expect(configuracionFaro({})).toBeNull();
    expect(configuracionFaro({ url: "   " })).toBeNull();
  });

  it("no inicializa con una URL que no sea https", () => {
    expect(
      configuracionFaro({ url: "http://colector.local/collect" }),
    ).toBeNull();
  });

  it("arma la app con la versión y el entorno del build", () => {
    expect(
      configuracionFaro({
        url: ` ${COLECTOR} `,
        version: "v0.5.0",
        entorno: "production",
      }),
    ).toEqual({
      url: COLECTOR,
      app: {
        name: NOMBRE_APP_FARO,
        version: "v0.5.0",
        environment: "production",
      },
    });
  });

  it("usa valores por defecto si faltan la versión o el entorno", () => {
    expect(
      configuracionFaro({ url: COLECTOR, version: "", entorno: undefined })
        ?.app,
    ).toEqual({
      name: NOMBRE_APP_FARO,
      version: "unknown",
      environment: "local",
    });
  });
});

describe("redacción de URLs (BL-214)", () => {
  it("reemplaza el token del QR en la ruta del comensal y en la de la API", () => {
    expect(redactarRuta(`/q/${QR_PRUEBA}`)).toBe("/q/[token]");
    expect(redactarRuta(`/menu/qr/${QR_PRUEBA}/privacidad`)).toBe(
      "/menu/qr/[token]/privacidad",
    );
    expect(redactarRuta("/admin/menu")).toBe("/admin/menu");
  });

  it("deja solo origen y ruta: sin query (qr, pago) ni hash (código de Keycloak)", () => {
    expect(
      redactarUrl(`https://bistrolink.app/privacidad?qr=${QR_PRUEBA}`),
    ).toBe("https://bistrolink.app/privacidad");
    expect(
      redactarUrl(
        "https://bistrolink.app/pago-completado?payment_id=123&status=approved",
      ),
    ).toBe("https://bistrolink.app/pago-completado");
    expect(redactarUrl("https://bistrolink.app/admin#state=abc&code=xyz")).toBe(
      "https://bistrolink.app/admin",
    );
    expect(redactarUrl(`https://bistrolink.app/q/${QR_PRUEBA}`)).toBe(
      "https://bistrolink.app/q/[token]",
    );
  });

  it("si no es una URL válida, redacta el texto igual", () => {
    expect(redactarUrl(`/q/${QR_PRUEBA}?x=1`)).toBe("/q/[token]?x=1");
  });

  it("redacta las URLs dentro del mensaje de un error", () => {
    const mensaje = `Failed to fetch https://api.bistrolink.app/menu/qr/${QR_PRUEBA}/privacidad?x=1 (500)`;
    expect(redactarTexto(mensaje)).toBe(
      "Failed to fetch https://api.bistrolink.app/menu/qr/[token]/privacidad (500)",
    );
  });

  it("no cambia un texto sin URLs ni tokens", () => {
    expect(redactarTexto("Cannot read properties of undefined")).toBe(
      "Cannot read properties of undefined",
    );
  });
});

describe("sanearItem (beforeSend de Faro, BL-214)", () => {
  it("redacta la URL de la página y el texto del error", () => {
    const item = {
      type: "exception",
      meta: {
        page: { url: `https://bistrolink.app/privacidad?qr=${QR_PRUEBA}` },
      },
      payload: {
        type: "Error",
        value: `fallo en /q/${QR_PRUEBA}`,
        stacktrace: { frames: [] },
      },
    };
    const saneado = sanearItem(item);
    expect(saneado).toBe(item);
    expect(saneado.meta.page.url).toBe("https://bistrolink.app/privacidad");
    expect(saneado.payload.value).toBe("fallo en /q/[token]");
    expect(saneado.payload.stacktrace).toEqual({ frames: [] });
  });

  it("redacta el mensaje de un log", () => {
    const item = {
      meta: {},
      payload: { message: `https://x.app/q/${QR_PRUEBA}#a` },
    };
    expect(sanearItem(item).payload.message).toBe("https://x.app/q/[token]");
  });

  it("acepta eventos sin página ni payload de texto", () => {
    const medicion = {
      meta: {},
      payload: { type: "web-vitals", values: { lcp: 1200 } },
    };
    expect(sanearItem(medicion)).toEqual({
      meta: {},
      payload: { type: "web-vitals", values: { lcp: 1200 } },
    });
    expect(sanearItem({ payload: null })).toEqual({ payload: null });
  });
});
