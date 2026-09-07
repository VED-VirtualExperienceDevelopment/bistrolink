// HU-002 / HU-003 / BL-155: Tipos compartidos del menú público y carrito
import type { EstadoPedido } from './pedido';

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
  observacion?: string; // BL-155: Nota del comensal para este ítem (ej. "sin cebolla")
}

// HU-003: forma de la respuesta de POST /pedidos
export interface PedidoConfirmado {
  id: string;
  estado: EstadoPedido; // Mantenemos el tipo fuerte que agregó develop
  createdAt: string;
}