import { enlacePedirPorWhatsapp } from "./whatsapp.utils";

/**
 * HU-010 (BL-613): enlace «¿Preferís pedir por WhatsApp?» del menú para
 * retirar. Va dentro de la portada, en el flujo de la página: no flota (un
 * botón flotante tapaba el carrito en el celular, como en BL-519).
 *
 * El ícono es una burbuja de chat genérica dibujada acá: no se usa el logo
 * de WhatsApp ni la fuente de íconos (que el menú del comensal no carga).
 */
export function PedirPorWhatsapp({ numero }: Readonly<{ numero: string }>) {
  return (
    <a
      href={enlacePedirPorWhatsapp(numero)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="pedir-por-whatsapp"
      className="mt-3 inline-flex w-max items-center gap-2 rounded-full bg-white/20 px-3 py-1.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
    >
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
      >
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.1A8 8 0 1 1 21 12Z" />
      </svg>
      ¿Preferís pedir por WhatsApp?
      <span className="sr-only">(se abre WhatsApp)</span>
    </a>
  );
}
