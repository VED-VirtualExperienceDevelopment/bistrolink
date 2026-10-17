'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getKeycloak } from '@/lib/keycloak';
import {
  usuarioSesion,
  type ClaimsPerfil,
  type UsuarioSesion,
} from './usuario-sesion.utils';

interface KeycloakContextValue {
  initializing: boolean;
  authenticated: boolean;
  token: string | undefined;
  tenantId: string | undefined;
  roles: string[];
  /** Quién inició sesión (BL-349). `undefined` mientras no haya sesión. */
  usuario: UsuarioSesion | undefined;
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
  const [usuario, setUsuario] = useState<UsuarioSesion | undefined>(undefined);
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
            | (ClaimsPerfil & {
                tenant_id?: string;
                realm_access?: { roles?: string[] };
              })
            | undefined;
          const rolesToken = parsed?.realm_access?.roles ?? [];
          setTenantId(parsed?.tenant_id);
          setRoles(rolesToken);
          // Nombre y usuario salen del scope `profile` del realm (BL-344).
          setUsuario(usuarioSesion(parsed, rolesToken));
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

  const logout = useCallback(() => {
    getKeycloak().logout({ redirectUri: window.location.origin });
  }, []);

  const hasRole = useCallback((role: string) => roles.includes(role), [roles]);

  // useMemo: el valor del contexto solo cambia cuando cambia la sesión, así
  // los componentes que usan useKeycloakAuth() no se vuelven a dibujar en
  // cada render del provider.
  const value = useMemo(
    () => ({
      initializing,
      authenticated,
      token,
      tenantId,
      roles,
      usuario,
      hasRole,
      logout,
    }),
    [initializing, authenticated, token, tenantId, roles, usuario, hasRole, logout],
  );

  return (
    <KeycloakContext.Provider value={value}>
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
