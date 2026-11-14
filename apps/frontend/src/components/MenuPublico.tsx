'use client';

import MenuDigital, { type CategoriaMenu } from './MenuDigital';
import type {
  CategoriaCarta,
  MarcaPublica,
  RestaurantePublico,
} from '@/types/menu';
import type { RetiroPublico } from './retiro/retiro.utils';

interface MenuPublicoProps {
  readonly restaurante: RestaurantePublico;
  readonly categorias: readonly CategoriaCarta[];
  readonly tenantId: string;
  readonly restauranteId: string;
  /** HU-043 (BL-534): logo y plantilla del local. */
  readonly marca?: MarcaPublica;
  /** HU-040 (BL-210): si el local toma pedidos para retirar ahora. */
  readonly retiro?: RetiroPublico;
}

export default function MenuPublico({
  restaurante,
  categorias,
  tenantId,
  restauranteId,
  marca,
  retiro,
}: MenuPublicoProps) {
  return (
    <MenuDigital
      origen={{ tipo: 'publico', tenantId, restauranteId }}
      restaurante={restaurante}
      categorias={categorias as unknown as CategoriaMenu[]}
      marca={marca}
      retiro={retiro}
    />
  );
}
