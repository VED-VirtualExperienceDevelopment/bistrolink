// HU-002: Tipos compartidos del menú público

export interface ItemCarta {
  id: string;
  nombre: string;
  descripcion?: string;
  precio: number;
  disponible: boolean;
  imagenUrl?: string;
}

export interface CategoriaCarta {
  id: string;
  nombre: string;
  items: ItemCarta[];
}

export interface RestaurantePublico {
  id: string;
  nombre: string;
  direccion: string;
}

// Es la forma del JSON que devuelve tu backend
export interface MenuPublicoResponse {
  restaurante: RestaurantePublico;
  categorias: CategoriaCarta[];
}

export interface ItemCarrito {
  itemCartaId: string;
  nombre: string;
  precio: number;
  cantidad: number;
  imagenUrl?: string;
}