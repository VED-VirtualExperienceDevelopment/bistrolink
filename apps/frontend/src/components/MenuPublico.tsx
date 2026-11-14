'use client';

import MenuDigital, { type CategoriaMenu } from './MenuDigital';
import type { CategoriaCarta, RestaurantePublico } from '@/types/menu';
import type { RetiroPublico } from './retiro/retiro.utils';

interface MenuPublicoProps {
  readonly restaurante: RestaurantePublico;
  readonly categorias: readonly CategoriaCarta[];
  readonly tenantId: string;
  readonly restauranteId: string;
  /** HU-040 (BL-210): si el local toma pedidos para retirar ahora. */
  readonly retiro?: RetiroPublico;
}

export default function MenuPublico({
  restaurante,
  categorias,
  tenantId,
  restauranteId,
  retiro,
}: MenuPublicoProps) {
  return (
    <MenuDigital
      origen={{ tipo: 'publico', tenantId, restauranteId }}
      restaurante={restaurante}
      categorias={categorias as unknown as CategoriaMenu[]}
      retiro={retiro}
    />
  );
}
