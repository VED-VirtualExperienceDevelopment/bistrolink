// HU-002 / HU-003 / BL-155: Tipos compartidos del menú público y carrito
import type { EstadoPedido } from "./pedido";
import type { RetiroPublico } from "@/components/retiro/retiro.utils";

export interface ItemCarta {
  id: string;
  nombre: string;
  descripcion?: string;
  precio: number;
  disponible: boolean;
  imagenUrl?: string;
  /** HU-044 (BL-537): «Sugerencia del local». */
  destacado?: boolean;
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

// HU-043 (BL-532): plantillas de marca, las mismas que valida la API.
export type PlantillaMarca = "clasica" | "gourmet" | "rapida" | "familiar";

// HU-043 (BL-532): marca del local en la carta. logoUrl null = sin logo
// (se muestra el nombre del local).
export interface MarcaPublica {
  logoUrl: string | null;
  // HU-043 (BL-562): foto de portada del banner. null = la de por defecto.
  // Opcional: una API anterior no la manda.
  portadaUrl?: string | null;
  plantilla: PlantillaMarca;
}

// Es la forma del JSON que devuelve tu backend
export interface MenuPublicoResponse {
  restaurante: RestaurantePublico;
  // Opcional: una API anterior a HU-043 no la manda (la carta usa la Clásica).
  marca?: MarcaPublica;
  categorias: CategoriaCarta[];
  // HU-040 (BL-210): si el local toma pedidos para retirar ahora. Opcional:
  // un backend anterior no lo manda (y entonces se puede pedir, como antes).
  retiro?: RetiroPublico;
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
  // BL-311 (RD.05): solo en pedidos para retirar. Se manda en X-Pedido-Token
  // para pagar y consultar el comprobante; los de mesa usan el QR.
  tokenAcceso?: string;
}
