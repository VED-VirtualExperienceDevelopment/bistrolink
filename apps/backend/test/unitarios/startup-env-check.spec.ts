import {
  checkRequiredEnvVars,
  problemasTokenComensal,
  variablesObsoletasPresentes,
} from '../../src/startup-env-check';

// Variables obligatorias al arrancar. Desde BL-581 la API firma siempre el
// token del comensal (HU-052), así que COMENSAL_TOKEN_CLAVE se exige en
// cualquier entorno. Las del comensal técnico de Keycloak ya no se usan
// (TC-U-572 a 574, que exigían KEYCLOAK_COMENSAL_USERNAME_SECRET en
// producción, se retiraron).

const CLAVE = 'clave-de-prueba-del-token-de-invitado-0001';

const BASE = {
  KEYCLOAK_CLIENT_SECRET: 'secreto-del-cliente',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  QR_TOKEN_KEY: 'clave-de-los-qr',
  COMENSAL_TOKEN_CLAVE: CLAVE,
};

describe('variables obligatorias al arrancar', () => {
  const original = process.env;

  afterEach(() => {
    process.env = original;
    jest.restoreAllMocks();
  });

  function conEntorno(variables: Record<string, string | undefined>) {
    process.env = { ...variables } as NodeJS.ProcessEnv;
  }

  it('con todas las variables arranca, en local y en producción', () => {
    conEntorno({ ...BASE, NODE_ENV: 'development' });
    expect(() => checkRequiredEnvVars()).not.toThrow();
    conEntorno({ ...BASE, NODE_ENV: 'production' });
    expect(() => checkRequiredEnvVars()).not.toThrow();
  });

  it('las variables de siempre se siguen exigiendo en cualquier entorno', () => {
    conEntorno({ NODE_ENV: 'development' });
    expect(() => checkRequiredEnvVars()).toThrow('KEYCLOAK_CLIENT_SECRET');
  });

  it('[TC-U-635] las variables del comensal técnico ya no se exigen y, si siguen cargadas, solo se avisa', () => {
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => {});
    conEntorno({
      ...BASE,
      NODE_ENV: 'production',
      COMENSAL_TOKEN_EMISOR: 'keycloak',
      KEYCLOAK_COMENSAL_PASSWORD: 'contraseña-vieja',
      KEYCLOAK_COMENSAL_USERNAME_SECRET: 'secreto-viejo',
    });

    expect(() => checkRequiredEnvVars()).not.toThrow();
    expect(aviso).toHaveBeenCalledTimes(1);
    const mensaje = aviso.mock.calls[0][0] as string;
    expect(mensaje).toContain('COMENSAL_TOKEN_EMISOR');
    expect(mensaje).toContain('KEYCLOAK_COMENSAL_PASSWORD');
    expect(mensaje).toContain('KEYCLOAK_COMENSAL_USERNAME_SECRET');
    // El aviso nombra las variables, nunca sus valores.
    expect(mensaje).not.toContain('contraseña-vieja');
    expect(mensaje).not.toContain('secreto-viejo');

    expect(variablesObsoletasPresentes({ ...BASE })).toEqual([]);
  });
});

// HU-052: la API firma el token del comensal; sin una clave válida no arranca.
describe('clave del token del comensal al arrancar (HU-052)', () => {
  const original = process.env;

  afterEach(() => {
    process.env = original;
  });

  it('[TC-U-615] sin clave, o con una clave corta, no arranca en ningún entorno', () => {
    for (const NODE_ENV of ['development', 'production']) {
      process.env = {
        ...BASE,
        NODE_ENV,
        COMENSAL_TOKEN_CLAVE: undefined,
      } as NodeJS.ProcessEnv;
      expect(() => checkRequiredEnvVars()).toThrow('COMENSAL_TOKEN_CLAVE');

      process.env.COMENSAL_TOKEN_CLAVE = 'corta';
      expect(() => checkRequiredEnvVars()).toThrow(/al menos 32 bytes/);
    }
  });

  it('[TC-U-616] con una clave válida, y opcionalmente la anterior, arranca', () => {
    expect(problemasTokenComensal({ COMENSAL_TOKEN_CLAVE: CLAVE })).toEqual([]);
    expect(
      problemasTokenComensal({
        COMENSAL_TOKEN_CLAVE: CLAVE,
        COMENSAL_TOKEN_CLAVE_ANTERIOR: `${CLAVE}-anterior`,
      }),
    ).toEqual([]);
    expect(problemasTokenComensal({}).map((p) => p.name)).toEqual([
      'COMENSAL_TOKEN_CLAVE',
    ]);
  });

  it('[TC-U-617] una clave mal formada no arranca, y el error nunca muestra la clave', () => {
    const corta = 'clave-corta-secreta';
    const problemas = problemasTokenComensal({ COMENSAL_TOKEN_CLAVE: corta });
    expect(problemas.map((p) => p.name)).toEqual(['COMENSAL_TOKEN_CLAVE']);
    expect(problemas[0].hint).not.toContain(corta);

    expect(
      problemasTokenComensal({
        COMENSAL_TOKEN_CLAVE: CLAVE,
        COMENSAL_TOKEN_CLAVE_ANTERIOR: CLAVE,
      })[0].hint,
    ).toMatch(/distinta de la actual/);
  });

  it('en NODE_ENV=test no se chequea (Jest corre sin .env real)', () => {
    process.env = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    expect(() => checkRequiredEnvVars()).not.toThrow();
  });
});
