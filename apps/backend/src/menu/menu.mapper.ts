import { Decimal } from '@prisma/client/runtime/library';

// Lógica pura de mapeo de entidades de Prisma a la forma que expone la API.
// Separada de menu.service.ts a propósito: acá no hay queries ni contexto de
// tenant, así que se puede testear con Jest sin tocar la base de datos.

export type ItemCartaRaw = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: Decimal;
  disponible: boolean;
  imagenKey: string | null;
};

export type ItemMenuDto = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: Decimal;
  disponible: boolean;
  imagenUrl: string | null;
};

// El criterio de aceptación de HU-001 es explícito: los ítems no disponibles
// se muestran "bloqueados visualmente", no se ocultan. Por eso este mapeo
// NUNCA excluye ítems por su campo `disponible` — solo lo propaga tal cual
// para que el frontend decida cómo pintarlo. Si en algún momento se decide
// ocultar ítems agotados en vez de bloquearlos, ese cambio de negocio va acá,
// no en el frontend.
export function mapItemToDto(
  item: ItemCartaRaw,
  imagenUrl: string | null,
): ItemMenuDto {
  return {
    id: item.id,
    nombre: item.nombre,
    descripcion: item.descripcion,
    precio: item.precio,
    disponible: item.disponible,
    imagenUrl,
  };
}
