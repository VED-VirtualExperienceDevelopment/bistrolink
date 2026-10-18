export const ROLES_VALIDOS = ["ADMIN", "MOZO"] as const;
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
  // BL-361: nulos en los usuarios creados antes del cambio.
  nombre?: string | null;
  apellido?: string | null;
}

export interface CrearUsuarioPayload {
  username: string;
  email?: string;
  nombre: string;
  apellido: string;
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

// BL-358: respuesta de PATCH /usuarios/:id/activar.
export interface ReactivarResponse {
  activo: true;
  id: string;
}

// BL-359: respuesta de POST /usuarios/:id/restablecer-contrasena.
export interface RestablecerContrasenaResponse {
  id: string;
  // Igual que en el alta: se muestra una única vez y no se guarda.
  temporaryPassword: string;
  // false si Keycloak no pudo cerrar sus sesiones abiertas.
  sesionesCerradas: boolean;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}
