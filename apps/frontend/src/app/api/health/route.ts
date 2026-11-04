/**
 * BL-223: healthcheck del frontend para Railway (Settings → Deploy →
 * Healthcheck Path = /api/health) y para el HEALTHCHECK del Dockerfile.
 *
 * Solo dice que el servidor de Next.js está levantado y responde: no
 * consulta la API ni Keycloak, para que una caída de otro servicio no deje
 * al frontend fuera de servicio. No devuelve datos del entorno.
 *
 * force-dynamic: sin esto Next.js la generaría una vez al compilar y la
 * serviría como archivo estático, aunque el servidor no estuviera bien.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
