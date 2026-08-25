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
 */
const baseSecurityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
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
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https: wss:; frame-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.s3.*.amazonaws.com",
      },
    ],
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
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        source: "/((?!silent-check-sso\\.html).*)",
        headers: [
          ...baseSecurityHeaders,
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
