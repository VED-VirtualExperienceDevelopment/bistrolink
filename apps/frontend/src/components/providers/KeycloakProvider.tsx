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
  type ResultadoAccionKeycloak,
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
  /**
   * BL-369: id de Keycloak de quien inició sesión (claim `sub`). Con él,
   * Admin → Usuarios reconoce la fila propia.
   */
  keycloakId: string | undefined;
  hasRole: (role: string) => boolean;
  logout: () => void;
  /**
   * BL-360: lleva a «Cambiá tu contraseña» de Keycloak y, al terminar o al
   * cancelar, vuelve a la misma pantalla.
   */
  cambiarContrasena: () => void;
  /** Resultado del último cambio de contraseña, al volver de Keycloak. */
  resultadoCambioContrasena: ResultadoAccionKeycloak | undefined;
  /** Borra ese resultado (cuando se cierra el aviso). */
  descartarResultadoCambioContrasena: () => void;
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
  const [keycloakId, setKeycloakId] = useState<string | undefined>(undefined);
  const [resultadoCambioContrasena, setResultadoCambioContrasena] = useState<
    ResultadoAccionKeycloak | undefined
  >(undefined);
  const initStarted = useRef(false);

  useEffect(() => {
    // React StrictMode monta los efectos dos veces en desarrollo —
    // keycloak-js no tolera bien un segundo init() en la misma instancia.
    if (initStarted.current) return;
    initStarted.current = true;

    const keycloak = getKeycloak();

    // BL-360: al volver de una acción iniciada por la aplicación, keycloak-js
    // lee `kc_action_status` de la URL dentro de init() y llama a este
    // callback. Por eso tiene que estar asignado ANTES de init(). La única
    // acción que la app inicia es UPDATE_PASSWORD.
    keycloak.onActionUpdate = (status) => setResultadoCambioContrasena(status);

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
          setKeycloakId(keycloak.subject);
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

  // BL-360: acción iniciada por la aplicación (kc_action=UPDATE_PASSWORD).
  // Así cada persona cambia su contraseña sin habilitar la consola de cuenta
  // de Keycloak, que sigue desactivada (BL-266). Si la sesión tiene más de
  // unos minutos, Keycloak primero pide la contraseña actual.
  const cambiarContrasena = useCallback(() => {
    getKeycloak().login({
      action: 'UPDATE_PASSWORD',
      redirectUri: window.location.href,
    });
  }, []);

  const descartarResultadoCambioContrasena = useCallback(
    () => setResultadoCambioContrasena(undefined),
    [],
  );

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
      keycloakId,
      hasRole,
      logout,
      cambiarContrasena,
      resultadoCambioContrasena,
      descartarResultadoCambioContrasena,
    }),
    [
      initializing,
      authenticated,
      token,
      tenantId,
      roles,
      usuario,
      keycloakId,
      hasRole,
      logout,
      cambiarContrasena,
      resultadoCambioContrasena,
      descartarResultadoCambioContrasena,
    ],
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
