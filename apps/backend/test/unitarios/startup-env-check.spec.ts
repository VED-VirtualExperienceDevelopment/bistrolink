import {
  checkRequiredEnvVars,
  problemasTokenComensal,
} from '../../src/startup-env-check';

// BL-271 (parte 4): KEYCLOAK_COMENSAL_USERNAME_SECRET es obligatoria solo en
// las imágenes de staging y producción (NODE_ENV=production).

const BASE = {
  KEYCLOAK_CLIENT_SECRET: 'secreto-del-cliente',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  QR_TOKEN_KEY: 'clave-de-los-qr',
};

describe('variables obligatorias al arrancar (BL-271)', () => {
  const original = process.env;

  afterEach(() => {
    process.env = original;
  });

  function conEntorno(variables: Record<string, string | undefined>) {
    process.env = { ...variables } as NodeJS.ProcessEnv;
  }

  it('[TC-U-572] en producción, sin el secreto del nombre del comensal, no arranca', () => {
    conEntorno({ ...BASE, NODE_ENV: 'production' });
    expect(() => checkRequiredEnvVars()).toThrow(
      'KEYCLOAK_COMENSAL_USERNAME_SECRET',
    );
  });

  it('[TC-U-573] en producción, con todas las variables, arranca', () => {
    conEntorno({
      ...BASE,
      NODE_ENV: 'production',
      KEYCLOAK_COMENSAL_USERNAME_SECRET: 'secreto-del-nombre',
    });
    expect(() => checkRequiredEnvVars()).not.toThrow();
  });

  it('[TC-U-574] en local (desarrollo) no se exige: usa el nombre anterior', () => {
    conEntorno({ ...BASE, NODE_ENV: 'development' });
    expect(() => checkRequiredEnvVars()).not.toThrow();
    conEntorno({ ...BASE });
    expect(() => checkRequiredEnvVars()).not.toThrow();
  });

  it('las variables de siempre se siguen exigiendo en cualquier entorno', () => {
    conEntorno({ NODE_ENV: 'development' });
    expect(() => checkRequiredEnvVars()).toThrow('KEYCLOAK_CLIENT_SECRET');
  });
});

// HU-052 (BL-579): con COMENSAL_TOKEN_EMISOR=api la API firma el token del
// comensal; sin una clave válida no arranca.
describe('configuración del token del comensal al arrancar (HU-052, BL-579)', () => {
  const original = process.env;
  const CLAVE = 'clave-de-prueba-del-token-de-invitado-0001';

  afterEach(() => {
    process.env = original;
  });

  it('[TC-U-615] con api y sin clave, o con una clave corta, no arranca', () => {
    process.env = {
      ...BASE,
      NODE_ENV: 'development',
      COMENSAL_TOKEN_EMISOR: 'api',
    } as NodeJS.ProcessEnv;
    expect(() => checkRequiredEnvVars()).toThrow('COMENSAL_TOKEN_CLAVE');

    process.env.COMENSAL_TOKEN_CLAVE = 'corta';
    expect(() => checkRequiredEnvVars()).toThrow(/al menos 32 bytes/);
  });

  it('[TC-U-616] con api y una clave válida arranca; sin emisor o con keycloak no exige clave', () => {
    process.env = {
      ...BASE,
      NODE_ENV: 'development',
      COMENSAL_TOKEN_EMISOR: 'api',
      COMENSAL_TOKEN_CLAVE: CLAVE,
    } as NodeJS.ProcessEnv;
    expect(() => checkRequiredEnvVars()).not.toThrow();

    expect(problemasTokenComensal({})).toEqual([]);
    expect(
      problemasTokenComensal({ COMENSAL_TOKEN_EMISOR: 'keycloak' }),
    ).toEqual([]);
  });

  it('[TC-U-617] un emisor desconocido o una clave mal formada no arrancan aunque el emisor sea Keycloak, y el error nunca muestra la clave', () => {
    expect(
      problemasTokenComensal({ COMENSAL_TOKEN_EMISOR: 'auth0' }).map(
        (p) => p.name,
      ),
    ).toEqual(['COMENSAL_TOKEN_EMISOR']);

    const corta = 'clave-corta-secreta';
    const problemas = problemasTokenComensal({
      COMENSAL_TOKEN_EMISOR: 'keycloak',
      COMENSAL_TOKEN_CLAVE: corta,
    });
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
    process.env = {
      NODE_ENV: 'test',
      COMENSAL_TOKEN_EMISOR: 'api',
    } as NodeJS.ProcessEnv;
    expect(() => checkRequiredEnvVars()).not.toThrow();
  });
});
