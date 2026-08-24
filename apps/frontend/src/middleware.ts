import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * SEGURIDAD (subtask BL-30): redirección automática HTTP → HTTPS.
 *
 * Railway termina TLS en su proxy y reenvía por HTTP interno con el header
 * x-forwarded-proto indicando el protocolo original del cliente. Si el
 * cliente pidió http://, respondemos 301 permanente a https://.
 *
 * En local (localhost/127.0.0.1) NO se redirige para no romper Playwright
 * ni el desarrollo local, donde no hay proxy de Railway.
 */
export function middleware(request: NextRequest) {
  const { hostname } = request.nextUrl;

  // En desarrollo local, no redirigir
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return NextResponse.next();
  }

  // En producción/staging, respetar x-forwarded-proto del proxy
  const proto = request.headers.get('x-forwarded-proto');

  if (proto && proto !== 'https') {
    const url = request.nextUrl.clone();
    url.protocol = 'https';
    return NextResponse.redirect(url, 301);
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/:path*',
};
