import { randomBytes } from 'node:crypto';

/**
 * HU-052 (BL-581): la API firma siempre el token del comensal y necesita
 * COMENSAL_TOKEN_CLAVE. En el CI viene de "Credenciales de esta corrida";
 * en local, si el .env no la tiene, se genera una para la corrida. Corre
 * antes de cada suite (setupFiles de jest-e2e.json), después de dotenv.
 */
if (!process.env.COMENSAL_TOKEN_CLAVE) {
  process.env.COMENSAL_TOKEN_CLAVE = randomBytes(32).toString('base64');
}
