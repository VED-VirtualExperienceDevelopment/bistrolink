/**
 * Verifica que las variables de entorno críticas para producción/staging
 * estén presentes ANTES de que Nest termine de levantar la app.
 *
 * Por qué existe este archivo separado (y no la validación dentro de cada
 * servicio): KeycloakAdminService valida KEYCLOAK_CLIENT_SECRET de forma
 * perezosa (recién al llamar a getAdminToken()) para poder ser instanciado
 * por Jest sin la variable. Eso significa que, sin este chequeo, un deploy
 * sin la variable configurada arrancaría "bien" y solo explotaría cuando
 * un usuario real intentara loguearse o un Admin creara un usuario —
 * mucho más difícil de diagnosticar que un fallo inmediato al arrancar.
 *
 * Se salta automáticamente en NODE_ENV=test para no afectar a Jest.
 */

interface RequiredEnvVar {
  name: string;
  hint: string;
}

const REQUIRED_ENV_VARS: RequiredEnvVar[] = [
  {
    name: 'KEYCLOAK_CLIENT_SECRET',
    hint:
      'Keycloak Admin Console → Clients → bistrolink-backend → Credentials → ' +
      'Client secret. En CI/staging/producción se setea como secret del ' +
      'pipeline o de la plataforma de deploy, nunca hardcodeado.',
  },
  {
    name: 'DATABASE_URL',
    hint: 'Connection string de Postgres. Ver .env.example en la raíz del repo.',
  },
];

export function checkRequiredEnvVars(): void {
  if (process.env.NODE_ENV === 'test') {
    // Jest corre sin .env real en CI (y sin necesitar Keycloak/Postgres
    // reales) — los servicios individuales validan lo que necesitan cuando
    // corresponde, mockeado. Este chequeo es solo para arranque real.
    return;
  }

  const missing = REQUIRED_ENV_VARS.filter(({ name }) => !process.env[name]);

  if (missing.length === 0) {
    return;
  }

  const lines = missing.map(
    ({ name, hint }) => `\n  ✗ ${name}\n      → ${hint}`,
  );

  throw new Error(
    `\n\n` +
      `═══════════════════════════════════════════════════════════════\n` +
      `  ERROR DE ARRANQUE: faltan variables de entorno obligatorias\n` +
      `═══════════════════════════════════════════════════════════════\n` +
      `\n` +
      `El backend no puede arrancar sin las siguientes variables ` +
      `(NODE_ENV="${process.env.NODE_ENV ?? 'undefined'}"):\n` +
      `${lines.join('\n')}\n` +
      `\n` +
      `Cómo arreglarlo:\n` +
      `  • En local: agregá las variables faltantes a tu archivo .env ` +
      `en apps/backend/ (mirá .env.example como referencia).\n` +
      `  • En CI/staging/producción: configurá los secrets/variables de ` +
      `entorno correspondientes en la plataforma (GitHub Actions, Railway, etc.) ` +
      `antes de este deploy.\n` +
      `\n` +
      `Esta validación vive en src/startup-env-check.ts y se salta ` +
      `automáticamente cuando NODE_ENV=test.\n` +
      `═══════════════════════════════════════════════════════════════\n`,
  );
}
