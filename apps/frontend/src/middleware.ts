import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * SEGURIDAD (subtask BL-30): redirección automática HTTP → HTTPS.
 *
 * Railway termina TLS en su proxy y reenvía por HTTP interno con el header
 * x-forwarded-proto indicando el protocolo original del cliente. Si el
 * cliente pidió http://, respondemos 301 permanente a https://.
 *
 * Solo aplica en producción: `next dev` fija x-forwarded-proto: http en
 * toda petición (incluso local, sin proxy real), así que sin este guard
 * el redirect entra en bucle contra un dev server que nunca sirve TLS.
 */
export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production') {
    return NextResponse.next();
  }

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
