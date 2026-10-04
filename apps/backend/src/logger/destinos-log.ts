// BL-273: a dónde y con qué formato salen los logs del backend.
//
// Antes, todo lo que no fuera NODE_ENV=production escribía con pino-pretty
// (texto con colores, un campo por línea), y en producción no había ninguna
// salida a stdout: solo Grafana Loki. Con eso, en Railway no se podía filtrar
// por campo en staging, y en producción no quedaba ningún log si Loki fallaba
// o si faltaba LOKI_URL (el transport se configuraba igual, con host
// "undefined").
//
// Ahora:
//   - Local y tests (NODE_ENV development, test o sin definir): pino-pretty,
//     legible en la consola.
//   - Staging y producción (cualquier otro NODE_ENV): JSON en stdout, una
//     línea por evento. Railway lo toma como log estructurado: muestra el
//     campo "message", convierte el nivel numérico de Pino (30 → info) y deja
//     filtrar por cualquier otro campo (@action:USUARIO_DESACTIVADO).
//   - Grafana Loki: además de lo anterior, solo si LOKI_URL está definida.
//   - LOG_LEVEL fija el nivel mínimo. Por defecto: debug en local, info en
//     staging y producción.

export interface DestinoLog {
  target: string;
  level: string;
  options: Record<string, unknown>;
}

export interface ConfiguracionLog {
  /** Nivel mínimo del logger (también se aplica a cada destino). */
  level: string;
  /** Campo del mensaje: "message" es el que muestra Railway. */
  messageKey: string;
  targets: DestinoLog[];
}

const ENTORNOS_LOCALES = ['development', 'test'];

export function esEntornoLocal(nodeEnv: string | undefined): boolean {
  return nodeEnv === undefined || ENTORNOS_LOCALES.includes(nodeEnv);
}

export function construirConfiguracionLog(
  env: NodeJS.ProcessEnv,
): ConfiguracionLog {
  const local = esEntornoLocal(env.NODE_ENV);
  const level = env.LOG_LEVEL || (local ? 'debug' : 'info');
  const messageKey = 'message';

  const salidaConsola: DestinoLog = local
    ? {
        target: 'pino-pretty',
        level,
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
          messageKey,
        },
      }
    : {
        // pino/file con destination 1 = stdout, sin formato: JSON por línea.
        target: 'pino/file',
        level,
        options: { destination: 1 },
      };

  const targets: DestinoLog[] = [salidaConsola];

  if (env.LOKI_URL) {
    targets.push({
      target: 'pino-loki',
      level,
      options: {
        batching: true,
        interval: 5,
        host: env.LOKI_URL,
        basicAuth: {
          username: env.LOKI_USERNAME,
          password: env.LOKI_PASSWORD,
        },
        labels: {
          app: 'bistrolink',
          env: env.NODE_ENV ?? 'staging',
          developer: env.DEV_NAME ?? 'unknown',
        },
      },
    });
  }

  return { level, messageKey, targets };
}
