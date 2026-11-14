'use client';

import MenuDigital, { type CategoriaMenu } from './MenuDigital';
import type {
  CategoriaCarta,
  MarcaPublica,
  RestaurantePublico,
} from '@/types/menu';

interface MenuPublicoProps {
  readonly restaurante: RestaurantePublico;
  readonly categorias: readonly CategoriaCarta[];
  readonly tenantId: string;
  readonly restauranteId: string;
  /** HU-043 (BL-534): logo y plantilla del local. */
  readonly marca?: MarcaPublica;
}

export default function MenuPublico({
  restaurante,
  categorias,
  tenantId,
  restauranteId,
  marca,
}: MenuPublicoProps) {
  return (
    <MenuDigital
      origen={{ tipo: 'publico', tenantId, restauranteId }}
      restaurante={restaurante}
      categorias={categorias as unknown as CategoriaMenu[]}
      marca={marca}
    />
  );
}
