import {
  construirConfiguracionLog,
  esEntornoLocal,
} from '../../src/logger/destinos-log';

describe('construirConfiguracionLog (BL-273)', () => {
  it('[TC-U-030] en local (NODE_ENV development, test o sin definir) los logs salen con pino-pretty', () => {
    expect(esEntornoLocal('development')).toBe(true);
    expect(esEntornoLocal('test')).toBe(true);
    expect(esEntornoLocal(undefined)).toBe(true);

    const config = construirConfiguracionLog({ NODE_ENV: 'development' });

    expect(config.targets.map((t) => t.target)).toEqual(['pino-pretty']);
    expect(config.targets[0].options).toMatchObject({ messageKey: 'message' });
    expect(config.level).toBe('debug');
  });

  it('[TC-U-031] en staging y producción los logs salen en JSON por stdout (sin pino-pretty)', () => {
    for (const NODE_ENV of ['staging', 'production']) {
      const config = construirConfiguracionLog({ NODE_ENV });

      expect(config.targets.map((t) => t.target)).not.toContain('pino-pretty');
      expect(config.targets[0]).toEqual({
        target: 'pino/file',
        level: 'info',
        options: { destination: 1 },
      });
      expect(config.messageKey).toBe('message');
    }
  });

  it('[TC-U-032] sin LOKI_URL no se configura Grafana Loki, pero stdout sigue activo', () => {
    const config = construirConfiguracionLog({ NODE_ENV: 'production' });

    expect(config.targets.map((t) => t.target)).toEqual(['pino/file']);
  });

  it('[TC-U-033] con LOKI_URL se agrega Grafana Loki además de stdout, con sus credenciales y etiquetas', () => {
    const config = construirConfiguracionLog({
      NODE_ENV: 'production',
      LOKI_URL: 'https://loki.example.com',
      LOKI_USERNAME: 'usuario',
      LOKI_PASSWORD: 'clave',
      DEV_NAME: 'railway',
    });

    expect(config.targets.map((t) => t.target)).toEqual([
      'pino/file',
      'pino-loki',
    ]);
    expect(config.targets[1].options).toMatchObject({
      host: 'https://loki.example.com',
      basicAuth: { username: 'usuario', password: 'clave' },
      labels: { app: 'bistrolink', env: 'production', developer: 'railway' },
    });
  });

  it('[TC-U-034] LOG_LEVEL fija el nivel del logger y de todos los destinos', () => {
    const config = construirConfiguracionLog({
      NODE_ENV: 'staging',
      LOKI_URL: 'https://loki.example.com',
      LOG_LEVEL: 'warn',
    });

    expect(config.level).toBe('warn');
    expect(config.targets.every((t) => t.level === 'warn')).toBe(true);
  });
});
