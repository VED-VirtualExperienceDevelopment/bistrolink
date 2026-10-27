// BL-163 (HU-027): tipos de /plataforma/establecimientos. Calcan las
// respuestas del backend (EstablecimientosService y AprovisionamientoService).

/**
 * BL-410: estado de cada establecimiento en el listado (lo calcula el
 * backend: SUSPENDIDO primero; si no, ALTA_INCOMPLETA mientras el alta no
 * terminó; si no, ACTIVO).
 */
export type EstadoEstablecimiento = "ACTIVO" | "SUSPENDIDO" | "ALTA_INCOMPLETA";

/** BL-410: valores del filtro `estado` de GET /plataforma/establecimientos. */
export type FiltroEstado = "ACTIVOS" | "SUSPENDIDOS" | "ALTA_INCOMPLETA";

export interface EstablecimientoListado {
  tenantId: string;
  razonSocial: string;
  rut: string;
  plan: string;
  /** Username del usuario de plataforma o "script:<usuario>"; null si no hay registro. */
  creadoPor: string | null;
  /** ISO 8601 (llega como string en el JSON). */
  creadoEl: string;
  /** null si el tenant todavía no tiene restaurante. */
  restaurante: { id: string; nombre: string } | null;
  /** BL-410 */
  estado: EstadoEstablecimiento;
  /** BL-418: sin ningún pedido; se puede eliminar definitivamente. */
  eliminable: boolean;
}

/**
 * BL-411: una cuenta del establecimiento en la ficha (sin contraseñas,
 * email ni ids). `ultimoIngreso`: ISO, null si no ingresó en los últimos 90
 * días, o ausente si Keycloak no pudo dar el dato.
 */
export interface CuentaFicha {
  username: string | null;
  nombre: string | null;
  apellido: string | null;
  activo: boolean;
  ultimoIngreso?: string | null;
}

/**
 * BL-414: un Administrador en la ficha. Suma el id de su fila en `usuario`,
 * para restablecerle la contraseña (sigue sin email ni id de Keycloak).
 */
export interface AdministradorFicha extends CuentaFicha {
  id: string;
}

/** BL-414: respuesta de restablecer la contraseña de un Administrador. */
export interface ContrasenaRestablecida {
  id: string;
  /** Temporal: se muestra una sola vez. */
  temporaryPassword: string;
  /** false si la contraseña cambió pero no se pudieron cerrar sus sesiones. */
  sesionesCerradas: boolean;
}

/** BL-414: el Administrador nuevo, con su contraseña temporal (una sola vez). */
export interface AdministradorCreado {
  id: string;
  username: string | null;
  nombre: string | null;
  apellido: string | null;
  email: string | null;
  temporaryPassword: string;
}

/** BL-414: lo que se escribe en «Agregar Administrador» (todo string). */
export interface FormularioAdministrador {
  nombre: string;
  apellido: string;
  username: string;
  email: string;
}

/** BL-411: GET /plataforma/establecimientos/:tenantId (fechas en ISO). */
export interface FichaEstablecimiento {
  tenantId: string;
  razonSocial: string;
  rut: string;
  plan: string;
  creadoPor: string | null;
  creadoEl: string;
  estado: EstadoEstablecimiento;
  altaCompletadaEn: string | null;
  suspension: { desde: string | null; motivo: string | null } | null;
  restaurante: {
    id: string;
    nombre: string;
    direccion: string;
    timezone: string;
  } | null;
  /** BL-414: con el id de su fila. */
  administradores: AdministradorFicha[];
  cocina: CuentaFicha[];
  resumen: {
    mesas: number;
    itemsCarta: number;
    pedidosRecientes: number;
    diasPedidos: number;
    /** BL-413: pedidos sin terminar (recibidos, en preparación o listos). */
    pedidosAbiertos: number;
  } | null;
  /** BL-418: sin ningún pedido; se puede eliminar definitivamente. */
  eliminable: boolean;
}

/**
 * BL-418: respuesta de DELETE /plataforma/establecimientos/:tenantId.
 * `pendientes`: usuarios de Keycloak que no se pudieron borrar (se
 * reintenta con el mismo DELETE); null si Keycloak no respondió.
 */
export interface ResultadoEliminacion {
  tenantId: string;
  /** false si los datos ya estaban borrados y solo se limpió Keycloak. */
  datosEliminados: boolean;
  cuentas: { eliminadas: number; pendientes: string[] | null };
}

/** BL-418: lo mínimo para confirmar la eliminación (ficha o fila del listado). */
export interface EstablecimientoAEliminar {
  tenantId: string;
  razonSocial: string;
  rut: string;
}

/**
 * BL-412: body de PATCH /plataforma/establecimientos/:tenantId. Solo lo que
 * cambió; el RUT sin separadores.
 */
export interface CambiosEstablecimiento {
  razonSocial?: string;
  rut?: string;
  plan?: string;
  restauranteNombre?: string;
  restauranteDireccion?: string;
}

/** BL-412: lo que se escribe en el formulario «Editar» (todo string). */
export interface FormularioEdicion {
  razonSocial: string;
  rut: string;
  plan: string;
  restauranteNombre: string;
  restauranteDireccion: string;
}

export interface PaginaEstablecimientos {
  pagina: number;
  tamanoPagina: number;
  total: number;
  items: EstablecimientoListado[];
}

export type RolAprovisionado = "ADMIN" | "COCINA" | "COMENSAL";

export interface UsuarioAprovisionado {
  rol: RolAprovisionado;
  username: string;
  keycloakId: string;
  creado: boolean;
  perfilCompletado?: boolean;
  /** Solo si el backend la generó: temporal, se muestra una sola vez. */
  passwordGenerada?: string;
}

export interface ResultadoAlta {
  tenantId: string;
  tenantCreado: boolean;
  restauranteId: string;
  restauranteCreado: boolean;
  mesaVirtualId: string;
  usuarios: UsuarioAprovisionado[];
}

/** Lo que se escribe en el formulario (todo string, como lo dan los inputs). */
export interface FormularioAlta {
  razonSocial: string;
  rut: string;
  restauranteNombre: string;
  restauranteDireccion: string;
  adminUsername: string;
  adminEmail: string;
  adminNombre: string;
  adminApellido: string;
  cocinaUsername: string;
  cocinaEmail: string;
}
