export const ROLES_VALIDOS = ["ADMIN", "MOZO"] as const;
export type UsuarioRol = (typeof ROLES_VALIDOS)[number];
// BL-362: en el listado aparece también la cuenta de cocina, que vive solo en
// Keycloak. No es un rol que se pueda asignar (no está en ROLES_VALIDOS).
export type RolListado = UsuarioRol | "COCINA";

export interface Usuario {
  id: string;
  // null en la cuenta de cocina (BL-362), que no tiene fila en `usuario`.
  restauranteId: string | null;
  keycloakId: string;
  rol: RolListado;
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
  // BL-362: true en la cuenta de cocina (una cuenta para toda la cocina). Su
  // `id` es el de Keycloak y sus acciones van por /usuarios/cocina/:id.
  cuentaCompartida?: boolean;
  // BL-368: último LOGIN en Keycloak (ISO). null = sin ingresos en los
  // últimos 90 días; undefined = el backend no lo pudo leer (no se muestra).
  ultimoIngreso?: string | null;
  // BL-382: tiene pedidos o historial de estados. Solo los que no tienen se
  // pueden eliminar. No viene en la cuenta de cocina (no se elimina).
  tieneHistorial?: boolean;
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

// PATCH /usuarios/:id: se manda solo lo que cambia (BL-366 suma los datos).
export interface ActualizarUsuarioPayload {
  rol?: UsuarioRol;
  nombre?: string;
  apellido?: string;
  email?: string;
}

// BL-382: respuesta de DELETE /usuarios/:id/permanente.
export interface EliminarResponse {
  eliminado: true;
  id: string;
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

// BL-367: respuesta de POST /usuarios/:id/cerrar-sesiones (y de la cuenta de
// cocina). Si Keycloak no las cierra, el backend responde 503: no hay
// «sesionesCerradas: false».
export interface CerrarSesionesResponse {
  id: string;
  sesionesCerradas: true;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}
