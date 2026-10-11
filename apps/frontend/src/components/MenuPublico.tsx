'use client';

import MenuDigital, { type CategoriaMenu } from './MenuDigital';
import type { CategoriaCarta, RestaurantePublico } from '@/types/menu';

interface MenuPublicoProps {
  readonly restaurante: RestaurantePublico;
  readonly categorias: readonly CategoriaCarta[];
  readonly tenantId: string;
  readonly restauranteId: string;
}

export default function MenuPublico({
  restaurante,
  categorias,
  tenantId,
  restauranteId,
}: MenuPublicoProps) {
  return (
    <MenuDigital
      origen={{ tipo: 'publico', tenantId, restauranteId }}
      restaurante={restaurante}
      categorias={categorias as unknown as CategoriaMenu[]}
    />
  );
}
