import Image from 'next/image';

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
  restaurante: { nombre: string; direccion: string };
  categorias: CategoriaMenu[];
};

async function getMenu(tenantId: string, mesaId: string): Promise<MenuResponse | null> {
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
}

function formatearPrecio(precio: string): string {
  return new Intl.NumberFormat('es-UY', {
    style: 'currency',
    currency: 'UYU',
    minimumFractionDigits: 0,
  }).format(Number(precio));
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
      <main className="flex min-h-screen items-center justify-center p-8">
        <p className="text-center text-lg">
          No encontramos el menú para esta mesa. Probá escaneando el código QR de nuevo.
        </p>
      </main>
    );
  }

  const { restaurante, categorias } = menu;

  return (
    <main className="mx-auto max-w-md pb-16">
      <header className="bg-brand-700 px-4 pb-6 pt-8 text-white">
        <h1 className="text-2xl font-bold">{restaurante.nombre}</h1>
        <p className="text-sm text-brand-100/80">{restaurante.direccion}</p>
      </header>

      <div className="px-4">
        {categorias.map((categoria) => (
          <section key={categoria.id} className="mt-6">
            <h2 className="mb-3 text-lg font-semibold text-brand-700">
              {categoria.nombre}
            </h2>

            <div className="flex flex-col gap-3">
              {categoria.items.map((item) => (
                <article
                  key={item.id}
                  className={`flex gap-3 rounded-xl border border-black/5 bg-white p-3 shadow-sm ${
                    !item.disponible ? 'opacity-40' : ''
                  }`}
                  aria-disabled={!item.disponible}
                >
                  {item.imagenUrl && (
                    <Image
                      src={item.imagenUrl}
                      alt={item.nombre}
                      width={72}
                      height={72}
                      className="h-18 w-18 shrink-0 rounded-lg object-cover"
                    />
                  )}

                  <div className="flex flex-1 flex-col justify-between">
                    <div>
                      <p className="font-medium text-foreground">{item.nombre}</p>
                      {item.descripcion && (
                        <p className="text-sm text-foreground/60">{item.descripcion}</p>
                      )}
                    </div>

                    <div className="mt-1 flex items-center gap-2">
                      <span className="font-semibold text-brand-700">
                        {formatearPrecio(item.precio)}
                      </span>
                      {!item.disponible && (
                        <span className="rounded bg-black/10 px-2 py-0.5 text-xs">
                          No disponible
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}