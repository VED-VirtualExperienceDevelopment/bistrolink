'use client';

import MenuDigital, { type CategoriaMenu } from './MenuDigital';

interface MenuMesaClienteProps {
  readonly restaurante: { nombre: string };
  readonly categorias: CategoriaMenu[];
  readonly tenantId: string;
  readonly mesaId: string;
}

export default function MenuMesaCliente({
  restaurante,
  categorias,
  tenantId,
  mesaId,
}: MenuMesaClienteProps) {
  return (
    <MenuDigital
      tipo="mesa"
      restaurante={restaurante}
      categorias={categorias}
      tenantId={tenantId}
      idOrigen={mesaId}
    />
  );
}
