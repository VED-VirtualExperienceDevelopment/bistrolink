import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * BL-223: ruta del healthcheck. Railway la consulta por HTTP interno y no
 * sigue redirecciones: con el 301 a HTTPS el deploy fallaba (Anexo 12, W4).
 */
export const RUTA_HEALTHCHECK = "/api/health";

/**
 * SEGURIDAD (subtask BL-30): redirección automática HTTP → HTTPS.
 *
 * Railway termina TLS en su proxy y reenvía por HTTP interno con el header
 * x-forwarded-proto indicando el protocolo original del cliente. Si el
 * cliente pidió http://, respondemos 301 permanente a https://.
 *
 * En local (localhost/127.0.0.1) NO se redirige para no romper Playwright
 * ni el desarrollo local, donde no hay proxy de Railway.
 *
 * El healthcheck (/api/health) tampoco se redirige (BL-223). Se excluye acá
 * y no en el matcher para que el test unitario cubra la excepción.
 */
export function middleware(request: NextRequest) {
  const { hostname, pathname } = request.nextUrl;

  // En desarrollo local, no redirigir
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return NextResponse.next();
  }

  // BL-223: el healthcheck de Railway entra por HTTP y no sigue el 301.
  if (pathname === RUTA_HEALTHCHECK) {
    return NextResponse.next();
  }

  // En producción/staging, respetar x-forwarded-proto del proxy
  const proto = request.headers.get("x-forwarded-proto");

  if (proto && proto !== "https") {
    const url = request.nextUrl.clone();
    url.protocol = "https";
    return NextResponse.redirect(url, 301);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
