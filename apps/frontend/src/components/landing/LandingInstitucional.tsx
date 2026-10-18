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

/**
 * BL-353: contenedor común de todas las bandas. Las bandas (fondo) ocupan
 * el ancho completo; el contenido llega hasta 1280 px, con márgenes de 16 px en
 * el celular, 24 px en la tablet y 48 px en PC.
 */
const CONTENEDOR = 'mx-auto w-full max-w-7xl px-4 md:px-6 lg:px-12';

/**
 * BL-354: títulos con tamaño fluido. Crecen de a poco con el ancho de la
 * pantalla en lugar de saltar en cada breakpoint.
 */
const TITULO_SECCION =
  'text-[clamp(1.375rem,1.1rem+1.2vw,2rem)] font-bold leading-tight text-primary';

/** Anillo de foco visible, el mismo que en el login (BL-347/BL-348). */
const FOCO =
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary-container';

export function LandingInstitucional() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* BL-353: encabezado fijo con la marca y el acceso del personal. Antes
          «Ingresar» aparecía recién al final de la página. */}
      <header className="sticky top-0 z-30 border-b border-outline-variant bg-surface/95 backdrop-blur">
        <div className={`${CONTENEDOR} flex h-16 items-center justify-between gap-4`}>
          <span className="flex items-center gap-2 text-headline-sm font-extrabold text-primary">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
              className="h-7 w-7 flex-none fill-primary-container"
            >
              <path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z" />
            </svg>
            BistroLink
          </span>
          <Link
            href="/login"
            className={`inline-flex min-h-12 items-center rounded-full bg-primary-container px-5 text-label-md font-bold text-on-primary transition-colors hover:bg-primary ${FOCO}`}
          >
            Ingresar
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-background">
          {/* BL-354: desde 1024 px, dos columnas: el texto a la izquierda y
              el panel de la marca a la derecha. */}
          <div
            className={`${CONTENEDOR} grid items-center gap-10 py-10 md:py-14 lg:grid-cols-2 lg:gap-16 lg:py-20`}
          >
            <div className="mx-auto max-w-2xl space-y-5 text-center lg:mx-0 lg:text-left">
              <span className="inline-block rounded-full border border-secondary-container bg-secondary-container px-3.5 py-1 text-label-sm font-semibold uppercase tracking-wide text-on-secondary-container">
                Gastronomía digital directa
              </span>

              <div>
                <h1 className="text-[clamp(2rem,1.4rem+3vw,3.5rem)] font-extrabold leading-[1.1] tracking-tight text-primary">
                  BistroLink
                </h1>
                <p className="mt-2 text-[clamp(1.125rem,1rem+0.6vw,1.5rem)] font-semibold leading-snug text-on-surface-variant">
                  Pedí y pagá desde la mesa, sin esperas.
                </p>
              </div>

              <p className="text-body-md text-on-surface-variant md:text-body-lg">
                BistroLink conecta el menú digital de tu restaurante con la cocina y la caja. Si
                estás en un local que lo usa, escaneá el código QR de tu mesa para ver el menú y
                hacer tu pedido.
              </p>

              {/* Puramente ilustrativo — no es un botón, no dispara ninguna
                  acción. El QR real está impreso en cada mesa y es específico
                  de esa mesa/restaurante, así que no hay nada genérico para
                  "probar" desde acá. */}
              <div className="flex flex-col items-center gap-2 pt-2 lg:hidden">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary-container text-on-secondary-container">
                  <span aria-hidden="true" className="material-symbols-outlined text-3xl">qr_code_2</span>
                </div>
                <p className="text-label-sm text-on-surface-variant">
                  Buscá el código QR impreso en tu mesa
                </p>
              </div>
            </div>

            {/* BL-354: panel de la marca, desde 1024 px. Mismo gradiente
                violeta y acento dorado que el login (BL-347). Es ilustrativo:
                no simula un menú ni un restaurante (ver la nota de arriba),
                solo el QR que el comensal va a encontrar en la mesa. */}
            <div className="relative hidden aspect-[5/4] items-center justify-center overflow-hidden rounded-3xl bg-[linear-gradient(160deg,#381e72_0%,#4f378a_100%)] p-10 text-on-primary lg:flex">
              <div
                aria-hidden="true"
                className="absolute -right-16 -top-16 h-64 w-64 rounded-full border-[28px] border-white/5"
              />
              <div
                aria-hidden="true"
                className="absolute -bottom-20 -left-12 h-56 w-56 rounded-full border-[24px] border-tertiary-fixed-dim/15"
              />
              <div className="relative flex flex-col items-center gap-6 text-center">
                <div className="flex h-36 w-36 items-center justify-center rounded-[2rem] bg-tertiary-fixed-dim text-on-tertiary-fixed shadow-xl">
                  <span aria-hidden="true" className="material-symbols-outlined text-[96px]">
                    qr_code_2
                  </span>
                </div>
                <div>
                  <p className="text-headline-sm font-bold">Buscá el código QR de tu mesa</p>
                  <p className="mt-2 max-w-xs text-body-md text-primary-fixed">
                    Escaneás, pedís y pagás desde tu celular. Sin instalar nada.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Cómo funciona */}
        <section className="bg-surface-container-low">
          <div className={`${CONTENEDOR} py-10 md:py-14`}>
            <div className="space-y-4">
              <div className="text-center">
                <h2 className={TITULO_SECCION}>¿Cómo funciona?</h2>
                <p className="text-label-sm text-on-surface-variant">
                  Tu pedido, en tres pasos
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3 lg:gap-6">
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
                        <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-primary">
                          {paso.icono}
                        </span>
                        <h3 className="text-body-lg font-bold text-on-surface">{paso.titulo}</h3>
                      </div>
                      <p className="mt-1 text-body-sm text-on-surface-variant">{paso.descripcion}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Beneficios */}
        <section className="bg-background">
          <div className={`${CONTENEDOR} py-10 md:py-14`}>
            <div className="space-y-4">
              <h2 className={`text-center ${TITULO_SECCION}`}>
                Tu experiencia sin fricciones
              </h2>

              {/* BL-354: 2 columnas en el celular y la tablet, 4 en PC. */}
              <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4 lg:gap-6">
                {BENEFICIOS.map((beneficio) => (
                  <div
                    key={beneficio.titulo}
                    className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-3.5 shadow-sm"
                  >
                    <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-secondary-container text-on-secondary-container">
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{beneficio.icono}</span>
                    </div>
                    <h3 className="text-label-md font-bold text-on-surface">{beneficio.titulo}</h3>
                    <p className="mt-1 text-body-sm text-on-surface-variant">{beneficio.descripcion}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* CTA de staff — BL-353: banda ancho comleto. El botón sigue
            siendo de ancho completo en el celular (zona táctil grande) y de
            ancho de contenido desde la tablet. */}
        <section className="bg-primary text-on-primary">
          <div className={`${CONTENEDOR} py-10 text-center md:py-14`}>
            <h2 className="text-[clamp(1.375rem,1.1rem+1.2vw,2rem)] font-bold leading-tight">
              ¿Sos parte del staff?
            </h2>
            <p className="mx-auto mt-1.5 max-w-xs text-body-sm text-primary-fixed">
              Ingresá para gestionar mesas, pedidos en tiempo real y la cocina.
            </p>
            <Link
              href="/login"
              className={`mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-on-primary px-4 text-body-lg font-bold text-primary transition-opacity hover:opacity-90 md:w-auto md:px-10 ${FOCO}`}
            >
              Ingresar
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-outline-variant">
        <div className={`${CONTENEDOR} py-6 text-center text-label-sm text-on-surface-variant`}>
          © {new Date().getFullYear()} BistroLink
        </div>
      </footer>
    </div>
  );
}
