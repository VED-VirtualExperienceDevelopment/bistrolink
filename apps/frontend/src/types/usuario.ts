export const ROLES_VALIDOS = ['ADMIN', 'MOZO'] as const;
export type UsuarioRol = (typeof ROLES_VALIDOS)[number];

export interface Usuario {
  id: string;
  restauranteId: string;
  keycloakId: string;
  rol: UsuarioRol;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
  // ASUNCIÓN sin confirmar contra usuarios.service.ts: la tabla `usuario` en
  // Postgres no persiste username/email (viven en Keycloak). Si listar() no
  // los enriquece consultando la Admin API de Keycloak, estos van a venir
  // undefined y la tabla cae al fallback (ver UsuariosTable).
  username?: string;
  email?: string;
}

export interface CrearUsuarioPayload {
  username: string;
  email?: string;
  rol: UsuarioRol;
  restauranteId: string;
}

export interface CrearUsuarioResponse extends Usuario {
  // Devuelta una única vez al crear — Keycloak no permite recuperarla
  // después, por eso el diálogo de alta la muestra con opción de copiar.
  temporaryPassword: string;
}

export interface ActualizarRolPayload {
  rol: UsuarioRol;
}

export interface DesactivarResponse {
  desactivado: true;
  id: string;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}