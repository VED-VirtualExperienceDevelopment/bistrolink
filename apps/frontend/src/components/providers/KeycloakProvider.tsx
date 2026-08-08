'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getKeycloak } from '@/lib/keycloak';

interface KeycloakContextValue {
  initializing: boolean;
  authenticated: boolean;
  token: string | undefined;
  tenantId: string | undefined;
  roles: string[];
  hasRole: (role: string) => boolean;
  logout: () => void;
}

const KeycloakContext = createContext<KeycloakContextValue | null>(null);

/**
 * Envuelve cualquier árbol de la app que necesite sesión de Keycloak.
 * Usa 'check-sso' (no 'login-required') a nivel de provider para no forzar
 * login en rutas públicas — la página que sí lo requiere (p.ej.
 * /admin/usuarios) llama a login() explícitamente si !authenticated.
 */
export function KeycloakProvider({ children }: { children: ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [tenantId, setTenantId] = useState<string | undefined>(undefined);
  const [roles, setRoles] = useState<string[]>([]);
  const initStarted = useRef(false);

  useEffect(() => {
    // React StrictMode monta los efectos dos veces en desarrollo —
    // keycloak-js no tolera bien un segundo init() en la misma instancia.
    if (initStarted.current) return;
    initStarted.current = true;

    const keycloak = getKeycloak();

    keycloak
      .init({
        onLoad: 'check-sso',
        silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
        pkceMethod: 'S256',
      })
      .then((auth) => {
        setAuthenticated(auth);
        if (auth) {
          setToken(keycloak.token);
          // tenant_id y roles de realm vienen como claims custom del token —
          // confirmar con el mapper real configurado en el realm de Keycloak
          // si estos nombres de claim no coinciden.
          const parsed = keycloak.tokenParsed as
            | { tenant_id?: string; realm_access?: { roles?: string[] } }
            | undefined;
          setTenantId(parsed?.tenant_id);
          setRoles(parsed?.realm_access?.roles ?? []);
        }
        setInitializing(false);
      })
      .catch((err) => {
        console.error('Error inicializando Keycloak:', err);
        setInitializing(false);
      });

    // Refresca el token 30s antes de que expire mientras haya sesión activa.
    keycloak.onTokenExpired = () => {
      keycloak
        .updateToken(30)
        .then(() => setToken(keycloak.token))
        .catch(() => {
          setAuthenticated(false);
          setToken(undefined);
        });
    };
  }, []);

  const logout = () => {
    getKeycloak().logout({ redirectUri: window.location.origin });
  };

  const hasRole = (role: string) => roles.includes(role);

  return (
    <KeycloakContext.Provider
      value={{ initializing, authenticated, token, tenantId, roles, hasRole, logout }}
    >
      {children}
    </KeycloakContext.Provider>
  );
}

export function useKeycloakAuth() {
  const ctx = useContext(KeycloakContext);
  if (!ctx) {
    throw new Error('useKeycloakAuth debe usarse dentro de <KeycloakProvider>');
  }
  return ctx;
}