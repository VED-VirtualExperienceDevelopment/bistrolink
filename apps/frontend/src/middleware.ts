import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * SEGURIDAD (subtask BL-30): redirección automática HTTP → HTTPS.
 *
 * Railway termina TLS en su proxy y reenvía por HTTP interno con el header
 * x-forwarded-proto indicando el protocolo original del cliente. Si el
 * cliente pidió http://, respondemos 301 permanente a https://.
 *
 * Si el header no está (health checks directos, entorno local), no se
 * redirige — así no rompemos el pipeline ni el desarrollo local.
 */
export function middleware(request: NextRequest) {
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
