'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  codigoDeError,
  headersMesaQr,
  mensajeErrorQr,
  RUTA_LLAMAR_MOZO,
  solicitudAuthComensal,
  type OrigenMenu,
} from '@/components/menu-digital.utils';
import {
  anuncioDelEstado,
  anuncioVisible,
  botonDeshabilitado,
  hastaDespuesDe429,
  LIMITE_LLAMADO_MS,
  textoBoton,
  type EstadoLlamado,
} from '@/components/llamar-mozo.utils';

interface LlamarMozoButtonProps {
  /**
   * HU-034 (BL-204): token opaco del QR. La mesa sale de acá, del lado del
   * servidor (POST /mesas/llamar con X-Mesa-Token); el botón no conoce ids.
   */
  readonly qrToken: string;
  /** HU-017 (BL-60): sesión de la mesa que vino con el menú. */
  readonly sesionMesa: string;
  /**
   * BL-592: «nav», en la barra superior del menú (compacto en pantallas
   * chicas; un error se muestra en una franja debajo de la barra);
   * «inline», dentro del contenido (pantalla de pago), con el error debajo
   * del botón.
   */
  readonly variante?: 'nav' | 'inline';
}

/** Vibración corta en el celular; sin soporte, no pasa nada. */
function vibrar(patron: number | number[]) {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(patron);
    }
  } catch {
    // Sin soporte de vibración.
  }
}

// Colores por estado. Ninguno depende solo del color: cada estado cambia
// también el ícono y el texto (BL-592, CA 9). «esperando» (429) se ve igual
// que «avisado»: para el comensal es lo mismo, el mozo ya sabe.
const CLASES_NAV: Record<EstadoLlamado, string> = {
  listo: 'bg-marca text-white border-2 border-marca hover:bg-marca-hover',
  enviando: 'bg-marca/10 text-marca border-2 border-transparent',
  avisado: 'bg-[#e3f4e7] text-[#1b5e2c] border-2 border-[#1b5e2c]',
  esperando: 'bg-[#e3f4e7] text-[#1b5e2c] border-2 border-[#1b5e2c]',
  error: 'bg-white text-[#93000a] border-2 border-[#ba1a1a] hover:bg-[#ffdad6]/40',
};

const CLASES_INLINE: Record<EstadoLlamado, string> = {
  listo: 'bg-white text-marca border border-marca/30 hover:border-marca hover:bg-marca/5',
  enviando: 'bg-marca/10 text-marca border border-transparent',
  avisado: 'bg-[#e3f4e7] text-[#1b5e2c] border border-[#1b5e2c]',
  esperando: 'bg-[#e3f4e7] text-[#1b5e2c] border border-[#1b5e2c]',
  error: 'bg-white text-[#93000a] border border-[#ba1a1a] hover:bg-[#ffdad6]/40',
};

export function LlamarMozoButton({
  qrToken,
  sesionMesa,
  variante = 'inline',
}: LlamarMozoButtonProps) {
  const origen: OrigenMenu = { tipo: 'mesa', qrToken, sesionMesa };
  const [estado, setEstado] = useState<EstadoLlamado>('listo');
  // Fin del límite de 1 llamado por minuto (avisado o 429); null sin límite.
  // Es interno: no se muestra ningún tiempo al comensal.
  const [hasta, setHasta] = useState<number | null>(null);
  // Ya llamó una vez: pasado el límite, el botón dice «Volver a llamar».
  const [yaLlamo, setYaLlamo] = useState(false);
  // Lo que se anuncia al lector al entrar a cada estado (ver anuncioDelEstado).
  const [anuncio, setAnuncio] = useState<string | null>(null);

  // Al vencer el límite, el botón vuelve a estar activo («Volver a llamar»).
  // Un solo temporizador hasta el vencimiento: no hay nada que mostrar
  // segundo a segundo.
  useEffect(() => {
    if (hasta === null) return;
    const temporizador = setTimeout(() => {
      setEstado('listo');
      setHasta(null);
      setAnuncio(null);
    }, Math.max(0, hasta - Date.now()));
    return () => clearTimeout(temporizador);
  }, [hasta]);

  function entrar(nuevo: EstadoLlamado, fin: number | null, mensajeError?: string | null) {
    setEstado(nuevo);
    setHasta(fin);
    setAnuncio(anuncioDelEstado(nuevo, mensajeError));
    if (nuevo === 'avisado' || nuevo === 'esperando') setYaLlamo(true);
  }

  async function llamar() {
    // aria-disabled en lugar de disabled: el botón no pierde el foco
    // mientras se envía o corre el límite, pero no hace nada.
    if (botonDeshabilitado(estado)) return;
    vibrar(50);
    entrar('enviando', null);

    try {
      const auth = solicitudAuthComensal(origen);
      const authRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}${auth.ruta}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(auth.body),
        },
      );
      if (!authRes.ok) {
        const cuerpo = await authRes.json().catch(() => null);
        vibrar(200);
        entrar('error', null, mensajeErrorQr(origen, authRes.status, codigoDeError(cuerpo)));
        return;
      }
      const { accessToken } = await authRes.json();

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}${RUTA_LLAMAR_MOZO}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...headersMesaQr(origen),
          },
        },
      );

      if (res.status === 429) {
        // Ya se avisó hace menos de un minuto (por ejemplo, antes de
        // recargar): no es un error, el mozo ya sabe.
        entrar('esperando', hastaDespuesDe429(res.headers.get('Retry-After'), Date.now()));
        return;
      }
      if (!res.ok) {
        const cuerpo = await res.json().catch(() => null);
        vibrar(200);
        entrar('error', null, mensajeErrorQr(origen, res.status, codigoDeError(cuerpo)));
        return;
      }

      vibrar([50, 100, 50]);
      entrar('avisado', Date.now() + LIMITE_LLAMADO_MS);
    } catch {
      vibrar(200);
      entrar('error', null);
    }
  }

  const esNav = variante === 'nav';
  const texto = textoBoton(estado, yaLlamo, esNav);
  const textoCompleto = textoBoton(estado, yaLlamo);
  const deshabilitado = botonDeshabilitado(estado);

  const boton = (
    <button
      type="button"
      onClick={() => void llamar()}
      // El nombre accesible acompaña al estado (no es fijo) y contiene el
      // texto visible (WCAG 2.5.3).
      aria-label={texto.etiqueta}
      aria-disabled={deshabilitado}
      aria-busy={estado === 'enviando'}
      className={`flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-marca/30 ${
        esNav ? 'min-h-11 px-4 text-sm' : 'min-h-12 px-8 text-sm md:text-base'
      } ${deshabilitado ? 'cursor-not-allowed' : ''} ${
        esNav ? CLASES_NAV[estado] : CLASES_INLINE[estado]
      }`}
    >
      <IconoEstado estado={estado} />
      {esNav ? (
        // BL-592 (CA 3): por debajo de 380 px, el texto corto («Mozo»,
        // «Avisado»); desde 380 px, el completo.
        <>
          <span className="min-[380px]:hidden">{texto.visible}</span>
          <span className="hidden min-[380px]:inline">{textoCompleto.visible}</span>
        </>
      ) : (
        <span>{texto.visible}</span>
      )}
    </button>
  );

  // Una sola región en vivo (<output>, rol «status»), siempre presente para
  // que el lector anuncie cada cambio. En «avisado» va oculta (sr-only): la
  // confirmación ya se ve en el botón. Solo el error se ve en pantalla.
  const visible = anuncio !== null && anuncioVisible(estado);

  if (esNav) {
    return (
      <>
        {boton}
        {/* El error va debajo de la barra superior (h-16), con la X fuera
            del <output> para que el lector no anuncie también «Cerrar». */}
        <div
          className={
            visible
              ? 'fixed inset-x-0 top-16 z-40 flex items-start justify-between gap-3 bg-[#ffdad6] px-4 py-2.5 text-sm font-semibold text-[#93000a] shadow-sm md:px-8'
              : 'sr-only'
          }
        >
          <output className="block">{anuncio}</output>
          {visible && (
            <button
              type="button"
              onClick={() => setAnuncio(null)}
              aria-label="Cerrar el aviso"
              className="-my-1 grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
            >
              <IconoCerrar />
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {boton}
      <output
        className={
          visible
            ? 'block text-center text-xs font-medium text-[#93000a]'
            : 'sr-only'
        }
      >
        {anuncio}
      </output>
    </div>
  );
}

function Svg({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

function IconoEstado({ estado }: { readonly estado: EstadoLlamado }) {
  switch (estado) {
    case 'listo':
      return (
        <Svg>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </Svg>
      );
    case 'enviando':
      // BL-592 (CA 10): gira solo si el usuario no pidió reducir el movimiento.
      return (
        <Svg className="motion-safe:animate-spin">
          <path d="M21 12a9 9 0 1 1-6.22-8.56" />
        </Svg>
      );
    case 'avisado':
    case 'esperando':
      return (
        <Svg>
          <path d="M20 6 9 17l-5-5" />
        </Svg>
      );
    case 'error':
      return (
        <Svg>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </Svg>
      );
  }
}

function IconoCerrar() {
  return (
    <Svg>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  );
}
