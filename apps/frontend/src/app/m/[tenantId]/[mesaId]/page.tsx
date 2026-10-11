import { cache } from 'react';
import type { Metadata } from 'next';
import MenuMesaCliente from '../../../../components/MenuMesaCliente'; // Importamos el nuevo componente

type ItemMenu = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: string;
  disponible: boolean;
  imagenUrl: string | null;
};

type CategoriaMenu = {
  id: string;
  nombre: string;
  items: ItemMenu[];
};

type MenuResponse = {
  restaurante: { nombre: string };
  categorias: CategoriaMenu[];
};

const getMenu = cache(async (tenantId: string, mesaId: string): Promise<MenuResponse | null> => {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/menu/${tenantId}/${mesaId}`, {
    cache: 'no-store',
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`Error al cargar el menú: ${res.status}`);
  }

  return res.json();
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantId: string; mesaId: string }>;
}): Promise<Metadata> {
  const { tenantId, mesaId } = await params;
  try {
    const menu = await getMenu(tenantId, mesaId);
    return { title: menu?.restaurante.nombre ?? 'Menú' };
  } catch {
    return { title: 'Menú' };
  }
}

export default async function MenuPage({
  params,
}: {
  params: Promise<{ tenantId: string; mesaId: string }>;
}) {
  const { tenantId, mesaId } = await params;
  const menu = await getMenu(tenantId, mesaId);

  if (menu === null) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8 bg-culinary-background">
        <div className="text-center bg-white p-8 rounded-[1rem] border border-culinary-neutral/10 shadow-sm">
          <div className="text-4xl mb-4">🔍</div>
          <p className="text-lg font-medium text-culinary-on-surface">
            No encontramos el menú para esta mesa.
          </p>
          <p className="text-sm text-culinary-neutral mt-2">
            Probá escaneando el código QR de nuevo.
          </p>
        </div>
      </main>
    );
  }

  // En lugar de dibujar la página aquí, le pasamos los datos al componente interactivo
  return (
    <MenuMesaCliente 
      restaurante={menu.restaurante} 
      categorias={menu.categorias} 
      tenantId={tenantId} 
      mesaId={mesaId} 
    />
  );
}
