import Keycloak from 'keycloak-js';

// Singleton: keycloak-js mantiene su propio estado de sesión (silent SSO,
// refresh token, etc.) — instanciarlo más de una vez en la misma pestaña
// duplica el iframe de silent-check-sso y genera condiciones de carrera.
//
// Variables de entorno requeridas (agregar a apps/frontend/.env si faltan):
//   NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:8080
//   NEXT_PUBLIC_KEYCLOAK_REALM=bistrolink
//   NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=bistrolink-frontend
//
// El cliente bistrolink-frontend en Keycloak debe estar configurado como
// "Public" (sin client secret) con PKCE (S256) habilitado — nunca como
// confidential, ya que el secret quedaría expuesto en el bundle del browser.

let keycloakInstance: Keycloak | null = null;

export function getKeycloak(): Keycloak {
  if (typeof window === 'undefined') {
    throw new Error('getKeycloak() solo puede llamarse en el cliente (browser)');
  }

  if (!keycloakInstance) {
    keycloakInstance = new Keycloak({
      url: process.env.NEXT_PUBLIC_KEYCLOAK_URL,
      realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM!,
      clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID!,
    });
  }

  return keycloakInstance;
}