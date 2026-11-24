'use client';

import MenuDigital, { type CategoriaMenu } from './MenuDigital';
import type { MarcaPublica } from '@/types/menu';

interface MenuMesaClienteProps {
  readonly restaurante: { nombre: string };
  readonly categorias: CategoriaMenu[];
  /** HU-034 (BL-204): token opaco del QR de la mesa (/q/<token>). */
  readonly qrToken: string;
  /** HU-017 (BL-60): sesión de la mesa que vino con el menú. */
  readonly sesionMesa: string;
  readonly numeroMesa: number;
  /** HU-043 (BL-534): logo y plantilla del local. */
  readonly marca?: MarcaPublica;
}

export default function MenuMesaCliente({
  restaurante,
  categorias,
  qrToken,
  sesionMesa,
  numeroMesa,
  marca,
}: MenuMesaClienteProps) {
  return (
    <MenuDigital
      origen={{ tipo: 'mesa', qrToken, sesionMesa }}
      restaurante={restaurante}
      categorias={categorias}
      numeroMesa={numeroMesa}
      marca={marca}
    />
  );
}
