import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * SEGURIDAD (subtask BL-30): headers de seguridad HTTP para todo el sitio.
 * Verificados con securityheaders.com en staging tras el deploy.
 *
 * Nota sobre la CSP: se usan esquemas amplios (https:, wss:) en img/connect/
 * frame-src para que funcione en staging y producción sin cambios (imágenes
 * de S3, API y Keycloak en dominios Railway distintos por entorno). Endurecer
 * a dominios específicos queda como mejora futura documentada.
 *
 * style-src / font-src incluyen explícitamente fonts.googleapis.com /
 * fonts.gstatic.com (Material Symbols) — sin esto, la CSP bloquea la hoja
 * de estilos de Google Fonts (visto en consola de staging).
 *
 * script-src incluye https://sdk.mercadopago.com (BL-311): el SDK de
 * Mercado Pago (Secure Fields) se carga desde ahí. Los campos de la tarjeta
 * son iframes de Mercado Pago, que ya entran en "frame-src https:", y la
 * tokenización usa "connect-src https:".
 *
 * img-src incluye blob: para la vista previa de la imagen del ítem antes de
 * subirla (ImageUploader usa URL.createObjectURL). Sin blob:, el navegador
 * bloquea la vista previa y la imagen recién se ve al guardar el ítem, cuando
 * llega la URL firmada de S3 (https:). blob: solo admite URLs que crea la
 * propia página en el navegador, así que no abre la carga de imágenes de
 * terceros.
 *
 * devFrameSrc / devConnectSrc (HU-004 y silent-check-sso de Keycloak): en
 * local, Keycloak (:8080) y la API (:3001) corren por HTTP plano, sin TLS.
 * "frame-src https:" no cubre "http://localhost:8080", así que sin esta
 * excepción el iframe de silent-check-sso queda bloqueado y el login entra
 * en loop infinito de redirects. Lo mismo para el WebSocket del KDS:
 * "connect-src wss:" no cubre el esquema "ws:" sin cifrar que usa el
 * navegador contra un host HTTP plano en local.
 *
 * DAST (BL-218, baseline de ZAP sobre la web de staging):
 * - 'unsafe-eval' solo en desarrollo: lo necesita el refresco en caliente de
 *   `next dev`; el build de producción no usa eval (alerta 10055).
 * - frame-ancestors en la CSP: es la única directiva que no hereda de
 *   default-src (alerta 10055 «No Fallback»). Repite lo que ya dice
 *   X-Frame-Options: 'none' en todo el sitio y 'self' en silent-check-sso.
 * - Cross-Origin-Resource-Policy y Cross-Origin-Opener-Policy (alerta
 *   90004): nadie de afuera puede incrustar las respuestas de la web ni
 *   quedarse con una referencia a la ventana. Keycloak y Mercado Pago no se
 *   ven afectados: el login es por redirección y los campos de la tarjeta son
 *   iframes, no ventanas emergentes.
 * - Cross-Origin-Embedder-Policy NO se agrega: con require-corp el navegador
 *   bloquea las imágenes de S3 y los iframes de Mercado Pago, que no mandan
 *   CORP. Riesgo aceptado (informe en docs/security/).
 * - 'unsafe-inline' en script-src y style-src se mantiene: Next.js inyecta
 *   scripts en línea para la hidratación y quitarlo exige una CSP con nonce
 *   por request, que vuelve dinámicas todas las páginas. Riesgo aceptado con
 *   mitigaciones (informe en docs/security/).
 */
const isProdBuild = process.env.NODE_ENV === "production";
const devScriptSrc = isProdBuild ? "" : " 'unsafe-eval'";
const devFrameSrc = isProdBuild ? "" : " http://localhost:8080";
const devConnectSrc = isProdBuild
  ? ""
  : " http://localhost:8080 http://localhost:3001 ws://localhost:3001";

/**
 * CSP del sitio. `frameAncestors` cambia según la ruta: 'none' en general y
 * 'self' en silent-check-sso.html (la propia app la carga en un iframe).
 */
function contentSecurityPolicy(frameAncestors) {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${devScriptSrc} https://sdk.mercadopago.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' https: wss:${devConnectSrc}`,
    `frame-src 'self' https:${devFrameSrc}`,
    `frame-ancestors ${frameAncestors}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const baseSecurityHeaders = [
  // SEGURIDAD (subtask BL-30): HSTS solo en producción. En dev, el navegador
  // recuerda esta política y fuerza HTTPS en las siguientes visitas a
  // localhost, pero `next dev` solo sirve HTTP plano -> ERR_CONNECTION_REFUSED
  // (o ERR_SSL_PROTOCOL_ERROR) hasta borrar la política manualmente en
  // chrome://net-internals/#hsts. Por eso se omite fuera de producción.
  ...(isProdBuild
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]
    : []),
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Cross-Origin-Resource-Policy",
    value: "same-origin",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // DAST (alerta 10037): sin el header «X-Powered-By: Next.js», que le dice
  // a un atacante qué framework y qué vulnerabilidades buscar.
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.s3.*.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  // BL-160: konva trae una rama de código para Node (lib/index-node.js) que
  // hace `require('canvas')` para poder dibujar sin navegador. No la usamos
  // -- el editor corre siempre en el cliente, vía next/dynamic con
  // `ssr: false` -- pero Webpack igual intenta RESOLVER ese require al
  // armar el bundle (aunque nunca se ejecute), y como "canvas" no está
  // instalado (es una dependencia nativa pesada, innecesaria acá), el build
  // rompe con "Module not found: Can't resolve 'canvas'". Marcarlo como
  // external le dice a Webpack que no intente empaquetarlo/resolverlo.
  webpack: (config) => {
    config.externals = [
      ...(config.externals ?? []),
      { canvas: "commonjs canvas" },
    ];
    return config;
  },
  async headers() {
    return [
      {
        // Keycloak (keycloak-js) necesita cargar esta página propia dentro
        // de un <iframe> oculto (same-origin, para el postMessage de vuelta
        // al padre) como parte del silent SSO check. X-Frame-Options: DENY
        // bloquea ESE framing aunque sea mismo origen, dejando el login
        // colgado en "Redirigiendo a inicio de sesión…" para siempre.
        // SAMEORIGIN sigue prohibiendo que un tercero embeba la página;
        // solo permite que la propia app se enmarque a sí misma.
        source: "/silent-check-sso.html",
        headers: [
          ...baseSecurityHeaders,
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy("'self'"),
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        source: "/((?!silent-check-sso\\.html).*)",
        headers: [
          ...baseSecurityHeaders,
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy("'none'"),
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
