import Link from 'next/link';

// Landing institucional de "/" sin sesión (BL-180). Contenido 100% estático,
// sin datos de ningún tenant puntual (eso ya existe en /m/[tenantId]) — ver
// la nota completa en page.tsx. Usa los mismos tokens de tailwind.config.ts
// y los íconos Material Symbols que ya carga layout.tsx (raíz) para el
// resto de la app, en vez de una fuente o set de íconos nuevo.
//
// A propósito NO incluye: un botón de "escanear QR" (no hay ningún QR
// genérico que escanear desde acá, cada uno es de una mesa/tenant real) ni
// una vista previa de mesa/menú simulada (insinuaría un restaurante que no
// existe) — ambos vinieron en un mockup de referencia y se descartaron por
// eso mismo.

const PASOS = [
  {
    icono: 'qr_code_scanner',
    titulo: 'Escaneás el QR de tu mesa',
    descripcion: 'Abrís la cámara de tu celular y apuntás al código en la mesa. Sin instalar nada.',
  },
  {
    icono: 'restaurant_menu',
    titulo: 'Elegís del menú digital',
    descripcion: 'Ves fotos, precios actualizados al instante, y armás tu pedido a tu ritmo.',
  },
  {
    icono: 'payments',
    titulo: 'Pagás sin esperar la cuenta',
    descripcion: 'Confirmás y pagás desde el celular; el pedido va directo a la cocina.',
  },
];

const BENEFICIOS = [
  {
    icono: 'bolt',
    titulo: 'Cero demoras',
    descripcion: 'Pedís apenas te sentás, sin esperar al mozo para tomar la orden.',
  },
  {
    icono: 'skillet',
    titulo: 'Directo a cocina',
    descripcion: 'Tu pedido llega a la pantalla de cocina al instante, sin reescrituras a mano.',
  },
  {
    icono: 'lock',
    titulo: 'Pagos seguros',
    descripcion: 'Pagás con tarjeta o billetera virtual, y recibís tu comprobante fiscal.',
  },
  {
    icono: 'inventory_2',
    titulo: 'Disponibilidad al día',
    descripcion: 'Si un plato se agotó, se saca solo del menú — no hace falta preguntar.',
  },
];

export function LandingInstitucional() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-md space-y-12 px-5 py-10 md:max-w-2xl md:px-8 md:py-14 lg:max-w-4xl lg:px-12 lg:py-20">
        {/* Hero */}
        <section className="mx-auto max-w-2xl space-y-5 text-center">
          <span className="inline-block rounded-full border border-secondary-container bg-secondary-container px-3.5 py-1 text-label-sm font-semibold uppercase tracking-wide text-on-secondary-container">
            Gastronomía digital directa
          </span>

          <div>
            <h1 className="text-headline-md font-extrabold tracking-tight text-primary md:text-headline-lg">
              Bistro Link
            </h1>
            <p className="mt-1 text-body-lg font-semibold text-on-surface-variant">
              Pedí y pagá desde la mesa, sin esperas.
            </p>
          </div>

          <p className="text-body-md text-on-surface-variant md:text-body-lg">
            Bistro Link conecta el menú digital de tu restaurante con la cocina y la caja. Si
            estás en un local que lo usa, escaneá el código QR de tu mesa para ver el menú y
            hacer tu pedido.
          </p>

          {/* Puramente ilustrativo — no es un botón, no dispara ninguna
              acción. El QR real está impreso en cada mesa y es específico
              de esa mesa/restaurante, así que no hay nada genérico para
              "probar" desde acá. */}
          <div className="flex flex-col items-center gap-2 pt-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary-container text-on-secondary-container">
              <span className="material-symbols-outlined text-3xl">qr_code_2</span>
            </div>
            <p className="text-label-sm text-on-surface-variant">
              Buscá el código QR impreso en tu mesa
            </p>
          </div>
        </section>

        {/* Cómo funciona */}
        <section className="space-y-4">
          <div className="text-center">
            <h2 className="text-headline-sm font-bold text-primary">¿Cómo funciona?</h2>
            <p className="text-label-sm text-on-surface-variant">
              Tu pedido, en tres pasos
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {PASOS.map((paso, i) => (
              <article
                key={paso.titulo}
                className="flex items-start gap-3.5 rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm md:flex-col md:gap-3"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-secondary-container bg-secondary-container text-on-secondary-container">
                  <span className="text-label-md font-bold">{i + 1}</span>
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[18px] text-primary">
                      {paso.icono}
                    </span>
                    <h3 className="text-body-lg font-bold text-on-surface">{paso.titulo}</h3>
                  </div>
                  <p className="mt-1 text-body-sm text-on-surface-variant">{paso.descripcion}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Beneficios */}
        <section className="space-y-4">
          <h2 className="text-center text-headline-sm font-bold text-primary">
            Tu experiencia sin fricciones
          </h2>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {BENEFICIOS.map((beneficio) => (
              <div
                key={beneficio.titulo}
                className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-3.5 shadow-sm"
              >
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-secondary-container text-on-secondary-container">
                  <span className="material-symbols-outlined text-[18px]">{beneficio.icono}</span>
                </div>
                <h3 className="text-label-md font-bold text-on-surface">{beneficio.titulo}</h3>
                <p className="mt-1 text-body-sm text-on-surface-variant">{beneficio.descripcion}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA de staff — más jerarquía que un link discreto, porque es la
            única forma de llegar a /login desde acá. Botón full-width en
            mobile (target táctil grande); en desktop un botón ancho de
            sobra se ve raro dentro de una tarjeta angosta, así que pasa a
            ancho de contenido centrado. */}
        <section className="mx-auto max-w-2xl rounded-3xl bg-primary p-6 text-center text-on-primary md:p-10">
          <h2 className="text-headline-sm font-bold">¿Sos parte del staff?</h2>
          <p className="mx-auto mt-1.5 max-w-xs text-body-sm text-primary-fixed">
            Ingresá para gestionar mesas, pedidos en tiempo real y la cocina.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-block w-full rounded-xl bg-on-primary px-4 py-3 text-body-lg font-bold text-primary transition-opacity hover:opacity-90 md:w-auto md:px-10"
          >
            Ingresar
          </Link>
        </section>
      </main>

      <footer className="border-t border-outline-variant py-6 text-center text-label-sm text-on-surface-variant">
        © {new Date().getFullYear()} Bistro Link
      </footer>
    </div>
  );
}