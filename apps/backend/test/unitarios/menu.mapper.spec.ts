import { Decimal } from '@prisma/client/runtime/library';
import { mapItemToDto, ItemCartaRaw } from '../../src/menu/menu.mapper';

// Test unitario de HU-001 (DoD: "lógica de filtrado de ítems no disponibles").
// El nombre del criterio en el DoD dice "filtrado", pero el criterio de
// aceptación real de la HU pide bloqueo visual, no exclusión — este test
// verifica ambas cosas: que disponible=false NUNCA desaparece del resultado
// (no se "filtra" en el sentido de eliminar), y que el mapeo de cada campo
// es correcto.

function itemBase(overrides: Partial<ItemCartaRaw> = {}): ItemCartaRaw {
  return {
    id: 'item-1',
    nombre: 'Milanesa a la napolitana',
    descripcion: 'Con papas fritas',
    precio: new Decimal('590.00'),
    disponible: true,
    imagenKey: 'tenant-1/items/milanesa.jpg',
    ...overrides,
  };
}

describe('mapItemToDto', () => {
  it('propaga un ítem disponible con todos sus campos', () => {
    const item = itemBase();

    const dto = mapItemToDto(item, 'https://s3.example.com/firmada');

    expect(dto).toEqual({
      id: 'item-1',
      nombre: 'Milanesa a la napolitana',
      descripcion: 'Con papas fritas',
      precio: item.precio,
      disponible: true,
      imagenUrl: 'https://s3.example.com/firmada',
    });
  });

  it('NO excluye un ítem no disponible — lo devuelve con disponible=false', () => {
    const item = itemBase({ disponible: false });

    const dto = mapItemToDto(item, null);

    // Este es el criterio de aceptación real de HU-001: bloqueo visual,
    // no ocultamiento. Si algún día esto cambia a "false" por error,
    // este test tiene que fallar.
    expect(dto.disponible).toBe(false);
    expect(dto).not.toBeNull();
    expect(dto.nombre).toBe(item.nombre);
  });

  it('mapea descripcion null sin romper (ítem sin descripción cargada)', () => {
    const item = itemBase({ descripcion: null });

    const dto = mapItemToDto(item, null);

    expect(dto.descripcion).toBeNull();
  });

  it('mapea imagenUrl null cuando el ítem no tiene imagenKey', () => {
    const item = itemBase({ imagenKey: null });

    // El caller (MenuService) es responsable de no llamar a StorageService
    // cuando imagenKey es null — acá solo verificamos que el mapper respeta
    // lo que le pasan, sin intentar generar una URL de la nada.
    const dto = mapItemToDto(item, null);

    expect(dto.imagenUrl).toBeNull();
  });

  it('preserva el precio como Decimal, sin convertir a number', () => {
    const item = itemBase({ precio: new Decimal('1234.56') });

    const dto = mapItemToDto(item, null);

    expect(dto.precio).toBeInstanceOf(Decimal);
    expect(dto.precio.toString()).toBe('1234.56');
  });
});
