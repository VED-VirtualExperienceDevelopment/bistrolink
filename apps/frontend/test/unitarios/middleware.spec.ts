import { NextRequest } from "next/server";
import { middleware, RUTA_HEALTHCHECK } from "@/middleware";
import { GET } from "@/app/api/health/route";

// BL-30 y BL-223: redirección HTTP → HTTPS del middleware y healthcheck
// del frontend para Railway.

const HOST = "https://bistrolink-web-staging.up.railway.app";

function pedido(ruta: string, proto?: string, base = HOST) {
  return new NextRequest(new URL(ruta, base), {
    headers: proto ? { "x-forwarded-proto": proto } : {},
  });
}

describe("middleware", () => {
  it("[TC-U-371] BL-30: un pedido por HTTP se redirige con 301 a la misma ruta por HTTPS", () => {
    const respuesta = middleware(pedido("/admin/mesas?x=1", "http"));

    expect(respuesta.status).toBe(301);
    expect(respuesta.headers.get("location")).toBe(`${HOST}/admin/mesas?x=1`);
  });

  it("[TC-U-372] BL-223: el healthcheck por HTTP no se redirige, pero una ruta parecida sí", () => {
    const salud = middleware(pedido(RUTA_HEALTHCHECK, "http"));
    expect(salud.status).toBe(200);
    expect(salud.headers.get("location")).toBeNull();

    // Solo la ruta exacta: no abre una excepción para otras rutas de /api.
    expect(middleware(pedido("/api/healthz", "http")).status).toBe(301);
    expect(middleware(pedido("/api/health/otra", "http")).status).toBe(301);
  });

  it("[TC-U-373] BL-30: por HTTPS, sin el header del proxy o en local no se redirige", () => {
    expect(middleware(pedido("/admin", "https")).status).toBe(200);
    expect(middleware(pedido("/admin")).status).toBe(200);
    expect(
      middleware(pedido("/admin", "http", "http://localhost:3000")).status,
    ).toBe(200);
  });
});

describe("GET /api/health", () => {
  it("[TC-U-374] BL-223: responde 200 con el estado y sin caché", async () => {
    const respuesta = GET();

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ status: "ok" });
    expect(respuesta.headers.get("cache-control")).toBe("no-store");
  });
});
