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

import { tokenInvitadoDesdeEntorno } from './auth-comensal/token-invitado';

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
  {
    // HU-034 (BL-204): QrMesaTokenService la valida recién al generar o
    // leer el primer QR; sin este chequeo, un deploy sin la clave arranca
    // bien y falla el menú de todas las mesas.
    name: 'QR_TOKEN_KEY',
    hint:
      'Clave AES de los QR de mesa: 32 bytes en base64, distinta por ' +
      'entorno. Ver el comentario en .env.example para generarla. Cambiarla ' +
      'invalida todos los QR impresos.',
  },
];

const COMO_GENERAR_CLAVE_COMENSAL =
  "Generala con: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\". " +
  'Va en Infisical, carpeta /api de cada entorno; nunca por chat ni en tickets.';

/**
 * HU-052: la API firma el token de invitado del comensal (desde BL-581, el
 * único emisor). Sin una clave válida arrancaría «bien» y respondería 500 a
 * cada comensal, así que no arranca: ni sin clave, ni con una clave mal
 * formada (corta, o la anterior igual a la actual).
 */
export function problemasTokenComensal(
  env: NodeJS.ProcessEnv,
): RequiredEnvVar[] {
  try {
    if (!tokenInvitadoDesdeEntorno(env)) {
      return [
        {
          name: 'COMENSAL_TOKEN_CLAVE',
          hint:
            'La API firma el token del comensal y necesita su clave (al ' +
            'menos 32 bytes). ' +
            COMO_GENERAR_CLAVE_COMENSAL,
        },
      ];
    }
  } catch (error) {
    return [
      {
        name: 'COMENSAL_TOKEN_CLAVE',
        hint: `${(error as Error).message}. ${COMO_GENERAR_CLAVE_COMENSAL}`,
      },
    ];
  }
  return [];
}

/**
 * BL-581: variables del comensal técnico de Keycloak, que ya no se usan.
 * No impiden el arranque; se avisa para borrarlas de Infisical y del .env.
 */
export const VARIABLES_OBSOLETAS_COMENSAL = [
  'COMENSAL_TOKEN_EMISOR',
  'KEYCLOAK_COMENSAL_PASSWORD',
  'KEYCLOAK_COMENSAL_USERNAME_SECRET',
] as const;

export function variablesObsoletasPresentes(env: NodeJS.ProcessEnv): string[] {
  return VARIABLES_OBSOLETAS_COMENSAL.filter((name) => env[name]);
}

export function checkRequiredEnvVars(): void {
  if (process.env.NODE_ENV === 'test') {
    // Jest corre sin .env real en CI (y sin necesitar Keycloak/Postgres
    // reales) — los servicios individuales validan lo que necesitan cuando
    // corresponde, mockeado. Este chequeo es solo para arranque real.
    return;
  }

  const obsoletas = variablesObsoletasPresentes(process.env);
  if (obsoletas.length > 0) {
    console.warn(
      `[startup] Variables que ya no se usan desde BL-581 (comensal técnico de Keycloak): ${obsoletas.join(', ')}. Borrarlas de Infisical y del .env.`,
    );
  }

  const missing = [
    ...REQUIRED_ENV_VARS.filter(({ name }) => !process.env[name]),
    ...problemasTokenComensal(process.env),
  ];

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
      `  o tienen un valor inválido\n` +
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
