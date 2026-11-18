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

import {
  emisorTokenComensalDesdeEntorno,
  tokenInvitadoDesdeEntorno,
} from './auth-comensal/token-invitado';

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

/**
 * BL-271 (parte 4): solo en las imágenes de staging y producción
 * (NODE_ENV=production). Con la protección contra fuerza bruta activa en el
 * realm, el usuario técnico del comensal tiene que tener un nombre que no se
 * deduzca del tenantId. Sin el secreto, la API volvería en silencio al nombre
 * anterior (`comensal-<tenantId>`), que en un entorno ya migrado no existe:
 * ningún comensal podría pedir. Mejor que no arranque. En local y en CI
 * (desarrollo) no se exige: ahí se usa el nombre anterior a propósito.
 */
const REQUIRED_IN_PRODUCTION_ENV_VARS: RequiredEnvVar[] = [
  {
    name: 'KEYCLOAK_COMENSAL_USERNAME_SECRET',
    hint:
      'Secreto con el que se calcula el nombre del usuario técnico del ' +
      'comensal (BL-271). En Infisical, carpeta /api del entorno. Antes de ' +
      'cargarlo por primera vez hay que crear los usuarios con ' +
      'scripts/migrar-comensal-tecnico.ts --aplicar. No va en el .env local.',
  },
];

const COMO_GENERAR_CLAVE_COMENSAL =
  "Generala con: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\". " +
  'Va en Infisical, carpeta /api de cada entorno; nunca por chat ni en tickets.';

/**
 * HU-052 (BL-579): configuración del token del comensal. Con
 * COMENSAL_TOKEN_EMISOR=api, la API firma el token de invitado: sin una
 * clave válida arrancaría «bien» y respondería 500 a cada comensal. Un
 * emisor desconocido o una clave mal formada (corta, o la anterior igual a
 * la actual) tampoco arrancan, aunque el emisor sea Keycloak, porque la
 * verificación (BL-578) también usa la clave.
 */
export function problemasTokenComensal(
  env: NodeJS.ProcessEnv,
): RequiredEnvVar[] {
  let emisor: string;
  try {
    emisor = emisorTokenComensalDesdeEntorno(env);
  } catch (error) {
    return [
      {
        name: 'COMENSAL_TOKEN_EMISOR',
        hint:
          `${(error as Error).message}. Sin la variable se usa keycloak ` +
          '(el usuario técnico del tenant, como hasta ahora).',
      },
    ];
  }

  try {
    const tokens = tokenInvitadoDesdeEntorno(env);
    if (emisor === 'api' && !tokens) {
      return [
        {
          name: 'COMENSAL_TOKEN_CLAVE',
          hint:
            'Con COMENSAL_TOKEN_EMISOR=api la API firma el token del ' +
            'comensal y necesita su clave (al menos 32 bytes). ' +
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

export function checkRequiredEnvVars(): void {
  if (process.env.NODE_ENV === 'test') {
    // Jest corre sin .env real en CI (y sin necesitar Keycloak/Postgres
    // reales) — los servicios individuales validan lo que necesitan cuando
    // corresponde, mockeado. Este chequeo es solo para arranque real.
    return;
  }

  const required =
    process.env.NODE_ENV === 'production'
      ? [...REQUIRED_ENV_VARS, ...REQUIRED_IN_PRODUCTION_ENV_VARS]
      : REQUIRED_ENV_VARS;
  const missing = [
    ...required.filter(({ name }) => !process.env[name]),
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
