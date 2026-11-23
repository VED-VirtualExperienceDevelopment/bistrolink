import { enlacePedirPorWhatsapp } from "./whatsapp.utils";

/**
 * HU-010 (BL-613): enlace «¿Preferís pedir por WhatsApp?» del menú para
 * retirar. Va dentro de la portada, en el flujo de la página: no flota (un
 * botón flotante tapaba el carrito en el celular, como en BL-519).
 *
 * El ícono es el glifo oficial de WhatsApp, verde sobre blanco, tal cual
 * viene en los recursos de marca de Meta (public/marcas/whatsapp/, sin
 * modificar). Las reglas de la marca: solo el archivo oficial, sin cambiarle
 * forma ni color, y sin que sea lo más destacado de la página. Es decorativo
 * (alt vacío): el texto ya dice «WhatsApp».
 */
export function PedirPorWhatsapp({ numero }: Readonly<{ numero: string }>) {
  return (
    <a
      href={enlacePedirPorWhatsapp(numero)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="pedir-por-whatsapp"
      className="mt-3 inline-flex w-max items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-[#1d1b20] shadow-sm transition-colors hover:bg-white/90 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG chico y fijo: next/image no aporta. */}
      <img
        src="/marcas/whatsapp/glifo-verde.svg"
        alt=""
        width={18}
        height={18}
      />
      ¿Preferís pedir por WhatsApp?
      <span className="sr-only">(se abre WhatsApp)</span>
    </a>
  );
}
