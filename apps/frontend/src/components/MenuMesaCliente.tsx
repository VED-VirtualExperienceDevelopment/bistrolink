'use client';

import MenuDigital, { type CategoriaMenu } from './MenuDigital';

interface MenuMesaClienteProps {
  readonly restaurante: { nombre: string };
  readonly categorias: CategoriaMenu[];
  /** HU-034 (BL-204): token opaco del QR de la mesa (/q/<token>). */
  readonly qrToken: string;
  readonly numeroMesa: number;
}

export default function MenuMesaCliente({
  restaurante,
  categorias,
  qrToken,
  numeroMesa,
}: MenuMesaClienteProps) {
  return (
    <MenuDigital
      origen={{ tipo: 'mesa', qrToken }}
      restaurante={restaurante}
      categorias={categorias}
      numeroMesa={numeroMesa}
    />
  );
}
