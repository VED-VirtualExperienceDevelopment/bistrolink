// BL-163 (HU-027): tipos de /plataforma/establecimientos. Calcan las
// respuestas del backend (EstablecimientosService y AprovisionamientoService).

export interface EstablecimientoListado {
  tenantId: string;
  razonSocial: string;
  rut: string;
  plan: string;
  /** Username del usuario de plataforma o "script:<usuario>"; null si no hay registro. */
  creadoPor: string | null;
  /** ISO 8601 (llega como string en el JSON). */
  creadoEl: string;
  /** null si el alta quedó a medias (tenant sin restaurante). */
  restaurante: { id: string; nombre: string } | null;
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
