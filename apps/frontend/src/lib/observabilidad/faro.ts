/**
 * BL-214: errores del navegador en Grafana Cloud (Frontend Observability,
 * SDK Grafana Faro). Lógica pura, probada en
 * test/unitarios/observabilidad-faro.spec.ts. El componente que inicializa
 * el SDK es components/providers/FrontendObservability.tsx.
 *
 * Por qué Faro y no Sentry: la observabilidad queda en una sola plataforma
 * (Grafana Cloud: logs en Loki, disponibilidad con Synthetic Monitoring,
 * alertas y ahora los errores del navegador), que ya usa todo el equipo.
 *
 * Qué NO se manda (Ley 18.331 y política de privacidad, HU-036):
 * - Datos personales: no se identifica al usuario (sin faro.api.setUser).
 * - Tokens en la URL: el QR de la mesa viaja en la ruta (/q/<token>) o como
 *   parámetro (?qr=<token>), y Keycloak devuelve el código de login en la
 *   URL. Por eso toda URL se reduce a origen + ruta, sin query ni hash, y
 *   el token del QR se reemplaza por [token].
 * - Mensajes de consola y tiempos de cada recurso: se desactivan en el
 *   componente (las URLs firmadas de S3 tienen la firma en la query).
 */

/** Nombre de la app en Frontend Observability. */
export const NOMBRE_APP_FARO = "bistrolink-web";

export interface ConfiguracionFaro {
  url: string;
  app: { name: string; version: string; environment: string };
}

/**
 * Configuración del SDK, o null si no hay que inicializarlo: sin URL del
 * colector (desarrollo local, tests) o con una URL que no sea https.
 */
export function configuracionFaro(valores: {
  url?: string;
  version?: string;
  entorno?: string;
}): ConfiguracionFaro | null {
  const url = valores.url?.trim();
  if (!url?.startsWith("https://")) {
    return null;
  }
  return {
    url,
    app: {
      name: NOMBRE_APP_FARO,
      version: valores.version?.trim() || "unknown",
      environment: valores.entorno?.trim() || "local",
    },
  };
}

// Token del QR de la mesa en una ruta: /q/<token> (página del comensal) o
// /qr/<token> (endpoints de la API, por ejemplo /menu/qr/<token>/privacidad).
const TOKEN_QR_EN_RUTA = /\/(q|qr)\/[^/?#\s"']+/g;

// URL absoluta con query o hash: se conserva solo hasta la ruta.
const QUERY_O_HASH_EN_URL = /(https?:\/\/[^\s"'?#]+)[?#][^\s"']*/g;

/** Reemplaza el token del QR de una ruta por [token]. */
export function redactarRuta(ruta: string): string {
  return ruta.replace(TOKEN_QR_EN_RUTA, "/$1/[token]");
}

/** Deja solo el origen y la ruta (sin query ni hash), con el token redactado. */
export function redactarUrl(url: string): string {
  try {
    const { origin, pathname } = new URL(url);
    return `${origin}${redactarRuta(pathname)}`;
  } catch {
    return redactarTexto(url);
  }
}

/** Redacta las URLs que aparezcan dentro de un texto (mensaje de error). */
export function redactarTexto(texto: string): string {
  return redactarRuta(texto.replace(QUERY_O_HASH_EN_URL, "$1"));
}

/** Lo mínimo que se lee de un evento de Faro (TransportItem). */
interface ItemFaro {
  meta?: { page?: { url?: string } };
  payload?: unknown;
}

/**
 * Hook beforeSend de Faro: redacta la URL de la página y el texto del
 * error o del log antes de mandarlo. Devuelve el mismo evento (modificado).
 */
export function sanearItem<T extends ItemFaro>(item: T): T {
  const pagina = item.meta?.page;
  if (pagina?.url) {
    pagina.url = redactarUrl(pagina.url);
  }

  const payload = item.payload as Record<string, unknown> | null | undefined;
  if (payload && typeof payload === "object") {
    for (const campo of ["value", "message"] as const) {
      const texto = payload[campo];
      if (typeof texto === "string") {
        payload[campo] = redactarTexto(texto);
      }
    }
  }
  return item;
}
