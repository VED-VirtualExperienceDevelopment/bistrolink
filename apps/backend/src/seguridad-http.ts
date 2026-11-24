import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { RUTA_DOCS } from './openapi';

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

/**
 * Sin espacios ni barra final: el navegador manda el Origin sin barra. Se
 * recorre con un bucle y no con una expresión regular (/\/+$/), que
 * SonarCloud marca por backtracking superlineal (S5852).
 */
function normalizarOrigen(url: string): string {
  let origen = url.trim();
  while (origen.endsWith('/')) origen = origen.slice(0, -1);
  return origen;
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
  const protocolo = proto?.split(',')[0].trim().toLowerCase();
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

/**
 * BL-526 (DAST, baseline de OWASP ZAP sobre la API): headers de seguridad.
 *
 * Antes se usaba `helmet()` con su configuración por defecto, pensada para
 * páginas web: su CSP permite estilos de cualquier origen `https:` y en
 * línea (alertas 10055 «Wildcard Directive» y «style-src unsafe-inline»).
 * La API responde JSON, que no carga nada: le alcanza con `default-src
 * 'none'`.
 *
 * La única página HTML es la documentación interactiva (Swagger UI, solo en
 * staging), que carga sus scripts y estilos del mismo origen y usa estilos
 * en línea. Tiene su propia CSP, sin el comodín `https:`.
 *
 * Además de lo que ya mandaba helmet (HSTS, X-Frame-Options,
 * X-Content-Type-Options, Referrer-Policy, Cross-Origin-Resource-Policy y
 * Cross-Origin-Opener-Policy):
 * - Cross-Origin-Embedder-Policy: require-corp (alerta 90004). En la API no
 *   rompe nada: Swagger UI carga todo del mismo origen.
 * - Permissions-Policy (alerta 10063): sin cámara, micrófono ni ubicación,
 *   igual que la web.
 */

/** Mismo valor que la web (next.config.mjs). */
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()';

/** CSP de las respuestas JSON: no se carga ni se embebe nada. */
export const CSP_API = {
  defaultSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'none'"],
};

/** CSP de Swagger UI: todo del mismo origen; estilos en línea de la UI. */
export const CSP_DOCS = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
};

/**
 * Si la ruta es la documentación interactiva: `/api/docs` y lo que cuelga
 * de ahí (sus scripts y estilos). `/api/docs-json` es JSON y lleva la CSP
 * de la API.
 */
export function esRutaDocs(ruta: string): boolean {
  const docs = `/${RUTA_DOCS}`;
  return ruta === docs || ruta.startsWith(`${docs}/`);
}

/** Middleware de Express para `main.ts`: headers de seguridad por ruta. */
export function headersDeSeguridad() {
  const comun = { crossOriginEmbedderPolicy: true } as const;
  const api = helmet({
    ...comun,
    contentSecurityPolicy: { useDefaults: false, directives: CSP_API },
  });
  const docs = helmet({
    ...comun,
    contentSecurityPolicy: { useDefaults: false, directives: CSP_DOCS },
  });
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    const conHelmet = esRutaDocs(req.path) ? docs : api;
    conHelmet(req, res, next);
  };
}
