import type { NextFunction, Request, Response } from 'express';

/**
 * BL-426 (parte de BL-424): CORS y redirección HTTP → HTTPS de la API.
 *
 * Antes, `app.enableCors()` (sin origen) y el gateway del KDS
 * (`origin: '*'`) aceptaban pedidos desde cualquier sitio. La sesión va en
 * un token Bearer y no en cookies, así que no habilitaba CSRF, pero no hay
 * motivo para aceptar otros orígenes. Ahora la API y los dos gateways usan
 * la misma lista, armada en un solo lugar.
 */

/** Frontend local (`npm run dev`), si no hay FRONTEND_URL. */
const FRONTEND_LOCAL = 'http://localhost:3000';

/** Sin espacios ni barra final: el navegador manda el Origin sin barra. */
function normalizarOrigen(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Orígenes que pueden llamar a la API y conectarse a los sockets:
 * - FRONTEND_URL (la misma que arma las URLs de los QR de mesa);
 * - CORS_ORIGENES_EXTRA, opcional: lista separada por comas (por ejemplo,
 *   un dominio propio al pasar a operación real).
 */
export function origenesPermitidos(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const principal = env.FRONTEND_URL?.trim() || FRONTEND_LOCAL;
  const extra = (env.CORS_ORIGENES_EXTRA ?? '')
    .split(',')
    .map((origen) => origen.trim())
    .filter(Boolean);
  return [...new Set([principal, ...extra].map(normalizarOrigen))];
}

export type DecisionHttps =
  | { tipo: 'seguir' }
  | { tipo: 'redirigir'; url: string }
  | { tipo: 'rechazar' };

/**
 * Railway termina TLS en su proxy y reenvía a la app por HTTP interno, con
 * `x-forwarded-proto`. Si el header no está (health checks directos al
 * contenedor, entorno local) no se redirige.
 *
 * La URL de destino ya no se arma con el header `Host` tal cual: solo se
 * redirige si el Host es el dominio público de la API (API_PUBLIC_HOST o,
 * si no está, RAILWAY_PUBLIC_DOMAIN, que Railway define solo). Con otro
 * Host, el pedido se rechaza.
 */
export function decidirRedireccionHttps(
  proto: string | undefined,
  host: string | undefined,
  rutaOriginal: string,
  env: NodeJS.ProcessEnv = process.env,
): DecisionHttps {
  const protocolo = proto?.split(',')[0]?.trim().toLowerCase();
  if (!protocolo || protocolo === 'https') return { tipo: 'seguir' };

  const dominio = (env.API_PUBLIC_HOST || env.RAILWAY_PUBLIC_DOMAIN)
    ?.trim()
    .toLowerCase();
  if (!dominio || host?.trim().toLowerCase() !== dominio) {
    return { tipo: 'rechazar' };
  }
  const ruta = rutaOriginal.startsWith('/') ? rutaOriginal : `/${rutaOriginal}`;
  return { tipo: 'redirigir', url: `https://${dominio}${ruta}` };
}

/** Middleware de Express para `main.ts`. */
export function redireccionHttps(env: NodeJS.ProcessEnv = process.env) {
  return (req: Request, res: Response, next: NextFunction) => {
    const decision = decidirRedireccionHttps(
      req.header('x-forwarded-proto'),
      req.header('host'),
      req.originalUrl,
      env,
    );
    if (decision.tipo === 'redirigir') {
      return res.redirect(301, decision.url);
    }
    if (decision.tipo === 'rechazar') {
      return res
        .status(400)
        .json({ statusCode: 400, message: 'Host no permitido' });
    }
    next();
  };
}
