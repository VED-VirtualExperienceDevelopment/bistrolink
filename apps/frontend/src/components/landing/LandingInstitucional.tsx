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
//
// BL-352: a todo el ancho y adaptada a celular, tablet y PC.

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

/** Etiquetas que flotan alrededor del QR en el panel de la marca. */
const ETIQUETAS_PANEL = [
  { icono: 'restaurant_menu', texto: 'Menú al instante', posicion: 'left-8 top-8' },
  { icono: 'skillet', texto: 'Directo a cocina', posicion: 'right-8 top-24' },
  { icono: 'payments', texto: 'Pagás desde la mesa', posicion: 'bottom-8 left-8' },
];

/**
 * BL-353: contenedor común de todas las bandas. Las bandas (fondo) ocupan
 * todo el ancho; el contenido llega hasta 1440 px, con márgenes de 16 px en
 * el celular, 32 px en la tablet y 64 px en PC.
 */
const CONTENEDOR = 'mx-auto w-full max-w-[1440px] px-4 md:px-8 lg:px-16';

/** BL-354: títulos con tamaño fluido, crecen de a poco con el ancho. */
const TITULO_SECCION =
  'text-[clamp(1.75rem,1.3rem+1.6vw,2.75rem)] font-extrabold leading-tight tracking-tight text-primary';

/** Anillo de foco visible, el mismo que en el login (BL-347/BL-348). */
const FOCO =
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary-container';

/**
 * Ícono de Material Symbols decorativo. El tamaño va en `style` porque la
 * hoja de Google Fonts fija `font-size: 24px` y pisa las clases de Tailwind.
 */
function Icono({ nombre, tamano, className = '' }: Readonly<{ nombre: string; tamano: number; className?: string }>)  {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined inline-block flex-none overflow-hidden ${className}`}
      // Ancho y alto fijos: si la fuente de íconos tarda o no carga, el
      // nombre del ícono no empuja el diseño ni genera scroll horizontal.
      style={{ fontSize: tamano, width: tamano, height: tamano, lineHeight: 1 }}
    >
      {nombre}
    </span>
  );
}

/**
 * QR ilustrativo para el panel de la marca: un patrón genérico, no un
 * código real (no lleva a ningún lado y no hay que escanearlo).
 */
function QrIlustrativo() {
  // 0/1 de un patrón de 21 × 21 (como un QR versión 1), sin las tres
  // esquinas, que se dibujan aparte.
  const modulos = [
    '000000000110100000000',
    '000000000111000000000',
    '000000001111100000000',
    '000000000111000000000',
    '000000000110000000000',
    '000000000100000000000',
    '000000001110100000000',
    '000000000001100000000',
    '101000100010010001110',
    '001001101011111110001',
    '010100001111110011101',
    '100111110101001001110',
    '110000010111000110010',
    '000000001010010110001',
    '000000001100101001101',
    '000000001110010001111',
    '000000001101010000101',
    '000000001100001001001',
    '000000000011000011001',
    '000000001001010001010',
    '000000000011101011011',
  ];
  return (
    <svg viewBox="0 0 21 21" aria-hidden="true" focusable="false" className="h-full w-full">
      {[
        [0, 0],
        [14, 0],
        [0, 14],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width="7" height="7" rx="1.5" className="fill-primary" />
          <rect x={x + 1} y={y + 1} width="5" height="5" rx="1" className="fill-white" />
          <rect x={x + 2} y={y + 2} width="3" height="3" rx="0.6" className="fill-primary" />
        </g>
      ))}
      {modulos.flatMap((fila, f) =>
        [...fila].map((celda, c) =>
          celda === '1' ? (
            <rect
              key={`${f}-${c}`}
              x={c + 0.05}
              y={f + 0.05}
              width="0.9"
              height="0.9"
              rx="0.2"
              className="fill-primary"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

export function LandingInstitucional() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* BL-353: encabezado fijo con la marca y el acceso del personal. */}
      <header className="sticky top-0 z-30 border-b border-outline-variant bg-surface/90 backdrop-blur">
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
            className={`inline-flex min-h-12 items-center gap-2 rounded-full bg-primary-container px-5 text-[15px] font-bold text-on-primary transition-colors hover:bg-primary ${FOCO}`}
          >
            <Icono nombre="login" tamano={20} />
            Ingresar
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero. BL-354: llena la primera pantalla en PC; desde 1024 px, el
            texto a la izquierda y el panel de la marca a la derecha. */}
        <section className="relative overflow-hidden bg-[radial-gradient(ellipse_at_top_right,#e9ddff_0%,transparent_55%)]">
          <div
            className={`${CONTENEDOR} grid items-center gap-10 py-12 md:py-16 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-20`}
          >
            <div className="mx-auto max-w-2xl text-center lg:mx-0 lg:text-left">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container px-3.5 py-1.5 text-[13px] font-semibold text-on-secondary-container">
                <Icono nombre="restaurant" tamano={16} />
                Gastronomía digital directa
              </span>

              <h1 className="mt-5 text-[clamp(2.5rem,1.6rem+4vw,4.75rem)] font-extrabold leading-[1.05] tracking-tight text-primary">
                Pedí y pagá desde la mesa,{' '}
                <span className="text-tertiary">sin esperas.</span>
              </h1>

              <p className="mt-5 text-[clamp(1rem,0.9rem+0.4vw,1.25rem)] leading-relaxed text-on-surface-variant">
                BistroLink conecta el menú digital de tu restaurante con la cocina y la caja. Si
                estás en un local que lo usa, escaneá el código QR de tu mesa para ver el menú y
                hacer tu pedido.
              </p>

              <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <a
                  href="#como-funciona"
                  className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 text-[16px] font-bold text-on-primary transition-colors hover:bg-primary-container ${FOCO}`}
                >
                  Cómo funciona
                  <Icono nombre="arrow_downward" tamano={20} />
                </a>
                <Link
                  href="/login"
                  className={`inline-flex min-h-12 items-center justify-center rounded-full border-2 border-primary px-7 text-[16px] font-bold text-primary transition-colors hover:bg-primary-fixed ${FOCO}`}
                >
                  Soy del personal
                </Link>
              </div>

              {/* Puramente ilustrativo — no es un botón. Solo en el celular
                  y la tablet; en PC lo reemplaza el panel de la derecha. */}
              <p className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-surface-container px-4 py-3 text-[14px] font-medium text-on-surface-variant lg:hidden">
                <Icono nombre="qr_code_2" tamano={28} className="text-primary" />
                Buscá el código QR impreso en tu mesa
              </p>
            </div>

            {/* BL-354: panel de la marca, desde 1024 px. Mismo gradiente
                violeta y acento dorado que el login (BL-347). Es ilustrativo:
                no simula un menú ni un restaurante, solo el QR que el
                comensal va a encontrar en la mesa. */}
            <div className="relative hidden aspect-square max-h-[620px] w-full overflow-hidden rounded-[2.5rem] bg-[linear-gradient(150deg,#381e72_0%,#4f378a_60%,#6750a4_100%)] shadow-2xl lg:block">
              <div
                aria-hidden="true"
                className="absolute -right-24 -top-24 h-80 w-80 rounded-full border-[36px] border-white/5"
              />
              <div
                aria-hidden="true"
                className="absolute -bottom-28 -left-20 h-72 w-72 rounded-full border-[32px] border-tertiary-fixed-dim/20"
              />

              <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-10 text-center text-on-primary">
                <div className="rounded-[2rem] bg-tertiary-fixed-dim p-5 shadow-xl">
                  <div className="h-44 w-44 rounded-2xl bg-white p-3">
                    <QrIlustrativo />
                  </div>
                </div>
                <div>
                  <p className="text-[26px] font-bold leading-tight">Buscá el código QR de tu mesa</p>
                  <p className="mx-auto mt-2 max-w-xs text-[16px] text-primary-fixed">
                    Escaneás, pedís y pagás desde tu celular. Sin instalar nada.
                  </p>
                </div>
              </div>

              {ETIQUETAS_PANEL.map((etiqueta) => (
                <span
                  key={etiqueta.texto}
                  aria-hidden="true"
                  className={`absolute ${etiqueta.posicion} hidden items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-[14px] font-semibold text-primary shadow-lg xl:inline-flex`}
                >
                  <Icono nombre={etiqueta.icono} tamano={20} className="text-tertiary" />
                  {etiqueta.texto}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Cómo funciona */}
        <section id="como-funciona" className="scroll-mt-16 bg-surface-container-low">
          <div className={`${CONTENEDOR} py-14 md:py-20`}>
            <div className="text-center">
              <h2 className={TITULO_SECCION}>¿Cómo funciona?</h2>
              <p className="mt-2 text-[17px] text-on-surface-variant">Tu pedido, en tres pasos</p>
            </div>

            <ol className="mt-10 grid gap-5 md:grid-cols-3 lg:gap-8">
              {PASOS.map((paso, i) => (
                <li
                  key={paso.titulo}
                  className="relative flex gap-4 rounded-3xl border border-outline-variant bg-surface-container-lowest p-6 shadow-sm md:flex-col md:p-8"
                >
                  <div className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-tertiary-fixed-dim text-[20px] font-extrabold text-on-tertiary-fixed">
                    {i + 1}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <Icono nombre={paso.icono} tamano={24} className="text-primary" />
                      <h3 className="text-[19px] font-bold text-on-surface">{paso.titulo}</h3>
                    </div>
                    <p className="mt-2 text-[15px] leading-relaxed text-on-surface-variant">
                      {paso.descripcion}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Beneficios */}
        <section className="bg-background">
          <div className={`${CONTENEDOR} py-14 md:py-20`}>
            <h2 className={`text-center ${TITULO_SECCION}`}>Tu experiencia sin fricciones</h2>

            {/* BL-354: 1 columna en el celular, 2 en la tablet y 4 en PC. */}
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
              {BENEFICIOS.map((beneficio) => (
                <div
                  key={beneficio.titulo}
                  className="rounded-3xl border border-outline-variant bg-surface-container-lowest p-6 shadow-sm transition-shadow hover:shadow-md md:p-7"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary-container text-on-secondary-container">
                    <Icono nombre={beneficio.icono} tamano={26} />
                  </div>
                  <h3 className="mt-4 text-[18px] font-bold text-on-surface">{beneficio.titulo}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-on-surface-variant">
                    {beneficio.descripcion}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA de staff — banda a todo el ancho. Desde 1024 px, texto a la
            izquierda y botón a la derecha. */}
        <section className="bg-[linear-gradient(120deg,#381e72_0%,#4f378a_100%)] text-on-primary">
          <div
            className={`${CONTENEDOR} flex flex-col items-center gap-6 py-14 text-center md:py-16 lg:flex-row lg:justify-between lg:text-left`}
          >
            <div>
              <h2 className="text-[clamp(1.75rem,1.3rem+1.6vw,2.75rem)] font-extrabold leading-tight tracking-tight">
                ¿Sos parte del staff?
              </h2>
              <p className="mt-2 max-w-xl text-[17px] text-primary-fixed">
                Ingresá para gestionar mesas, pedidos en tiempo real y la cocina.
              </p>
            </div>
            <Link
              href="/login"
              className={`inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-tertiary-fixed-dim px-10 text-[17px] font-bold text-on-tertiary-fixed transition-transform hover:scale-[1.02] sm:w-auto focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-tertiary-fixed-dim`}
            >
              Ingresar
              <Icono nombre="arrow_forward" tamano={22} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-outline-variant bg-surface">
        <div
          className={`${CONTENEDOR} flex flex-col items-center justify-between gap-2 py-6 text-[13px] text-on-surface-variant sm:flex-row`}
        >
          <span className="font-bold text-primary">BistroLink</span>
          <span>© {new Date().getFullYear()} BistroLink · Pedí y pagá desde la mesa</span>
        </div>
      </footer>
    </div>
  );
}
