import { checkRequiredEnvVars } from '../../src/startup-env-check';

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
