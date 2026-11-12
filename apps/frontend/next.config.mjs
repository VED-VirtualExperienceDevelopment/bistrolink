import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * SEGURIDAD (subtask BL-30): headers de seguridad HTTP para todo el sitio.
 * Verificados con securityheaders.com en staging tras el deploy.
 *
 * CSP con orígenes concretos (BL-523, alerta 10055 «Wildcard Directive» del
 * DAST): cada directiva lista solo los orígenes que la app usa, en lugar de
 * cualquier "https:". Los orígenes propios salen de las variables
 * NEXT_PUBLIC_* del build (el CI las pasa como build-args por entorno), así
 * que la misma regla sirve en local, staging y producción:
 * - API (NEXT_PUBLIC_API_URL): fetch y el WebSocket de socket.io (el mismo
 *   host con ws:/wss:).
 * - Keycloak (NEXT_PUBLIC_KEYCLOAK_URL): token por fetch y el iframe de
 *   silent-check-sso. En local es http://localhost:8080 y queda cubierto por
 *   la variable, sin excepciones aparte.
 * - Faro (NEXT_PUBLIC_FARO_URL): envío de errores y métricas, si está.
 * Orígenes externos fijos:
 * - Imágenes: S3 (URLs firmadas del panel y subida con POST firmado) y la CDN
 *   de la carta (CloudFront), con comodín de subdominio porque el bucket y la
 *   distribución cambian por entorno. La portada usa images.unsplash.com.
 * - Mercado Pago (BL-311): el SDK se carga de sdk.mercadopago.com, y sus
 *   campos de tarjeta (iframes), la tokenización y la prevención de fraude
 *   usan subdominios de mercadopago.com, mercadolibre.com, mercadolivre.com
 *   y mlstatic.com.
 * - Sin Google Fonts: Plus Jakarta Sans (BL-222) y Material Symbols (BL-524)
 *   están autoalojadas, así que style-src y font-src son solo 'self'.
 *
 * img-src incluye blob: para la vista previa de la imagen del ítem antes de
 * subirla (ImageUploader usa URL.createObjectURL). blob: solo admite URLs que
 * crea la propia página, así que no abre la carga de imágenes de terceros.
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
const devScriptSrc = isProdBuild ? [] : ["'unsafe-eval'"];

/** Origen (esquema + host + puerto) de una URL, o null si no es válida. */
function origenDe(url) {
  if (!url) return null;
  try {
    const { origin } = new URL(url);
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/** El mismo origen con el esquema del WebSocket (http→ws, https→wss). */
function origenWebSocket(origen) {
  return origen ? origen.replace(/^http/, "ws") : null;
}

const API = origenDe(
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
);
const KEYCLOAK = origenDe(
  process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8080",
);
const FARO = origenDe(process.env.NEXT_PUBLIC_FARO_URL);

const IMAGENES = [
  "https://*.amazonaws.com",
  "https://*.cloudfront.net",
  "https://images.unsplash.com",
];
const MERCADO_PAGO = [
  "https://*.mercadopago.com",
  "https://*.mercadolibre.com",
  // Prevención de fraude del SDK: carga imágenes de sesión desde el dominio
  // de Brasil (www.mercadolivre.com/jms/mlb/...), visto en la prueba local.
  "https://*.mercadolivre.com",
  "https://*.mlstatic.com",
];

/** Une las fuentes de una directiva, sin vacíos ni repetidos. */
function directiva(nombre, fuentes) {
  const unicas = [...new Set(fuentes.filter(Boolean))];
  return `${nombre} ${unicas.join(" ")}`;
}

/**
 * CSP del sitio. `frameAncestors` cambia según la ruta: 'none' en general y
 * 'self' en silent-check-sso.html (la propia app la carga en un iframe).
 */
function contentSecurityPolicy(frameAncestors) {
  return [
    "default-src 'self'",
    directiva("script-src", [
      "'self'",
      "'unsafe-inline'",
      ...devScriptSrc,
      "https://sdk.mercadopago.com",
      ...MERCADO_PAGO,
    ]),
    directiva("style-src", ["'self'", "'unsafe-inline'"]),
    directiva("img-src", [
      "'self'",
      "data:",
      "blob:",
      ...IMAGENES,
      ...MERCADO_PAGO,
    ]),
    directiva("font-src", ["'self'", "data:"]),
    directiva("connect-src", [
      "'self'",
      API,
      origenWebSocket(API),
      KEYCLOAK,
      FARO,
      "https://*.amazonaws.com",
      ...MERCADO_PAGO,
    ]),
    directiva("frame-src", ["'self'", KEYCLOAK, ...MERCADO_PAGO]),
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
