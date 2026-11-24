"use client";

import { useState } from "react";
import {
  estadoDeTarjeta,
  NOMBRE_TARJETAS_ACEPTADAS,
  TEXTO_PAGO_SEGURO,
  textoTarjeta,
  type TarjetaAceptada,
} from "./tarjetas-aceptadas.utils";

/**
 * Si la imagen ya falló antes de que React se enganchara (la página llega
 * renderizada del servidor y el error puede llegar antes de la hidratación),
 * onError no se dispara: se revisa al montar.
 */
function siYaFallo(alFallar: () => void) {
  return (img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) alFallar();
  };
}

/**
 * Logo oficial de Mercado Pago (kit de marca, marzo 2025), tal cual: sin
 * redibujar, recolorear ni recortar (ver public/marcas/README.md). El SVG
 * trae su propio margen, por eso se muestra a 40 px de alto: la marca
 * queda de unos 20 px.
 */
export const LOGO_MERCADO_PAGO = "/marcas/mercado-pago.svg";

const CLASE_ESTADO = {
  normal: "border-culinary-neutral/30",
  detectada: "border-marca ring-2 ring-marca/30",
  // Solo la imagen se atenúa: el nombre (si la imagen no carga) mantiene
  // el contraste de texto (WCAG 1.4.3).
  atenuada:
    "border-culinary-neutral/20 [&_img]:opacity-40 [&_img]:grayscale [&_span]:text-[#5a575e]",
} as const;

/** Una tarjeta: la imagen de Mercado Pago o, si no carga, su nombre. */
function Tarjeta({
  tarjeta,
  estado,
}: Readonly<{ tarjeta: TarjetaAceptada; estado: keyof typeof CLASE_ESTADO }>) {
  const [sinImagen, setSinImagen] = useState(!tarjeta.imagen);
  const texto = textoTarjeta(tarjeta);
  return (
    <li
      data-estado={estado}
      className={`flex h-8 min-w-12 items-center justify-center rounded-md border bg-white px-1.5 transition-opacity ${CLASE_ESTADO[estado]}`}
    >
      {sinImagen || !tarjeta.imagen ? (
        <span className="text-xs font-semibold text-foreground">
          {tarjeta.nombre}
          {texto !== tarjeta.nombre && (
            <span className="sr-only">
              {texto.slice(tarjeta.nombre.length)}
            </span>
          )}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tarjeta.imagen}
          alt={texto}
          width={40}
          height={24}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          ref={siYaFallo(() => setSinImagen(true))}
          onError={() => setSinImagen(true)}
          className="h-6 w-10 object-contain"
        />
      )}
    </li>
  );
}

/**
 * HU-051 (BL-563): sello de pago seguro arriba del formulario de tarjeta.
 *
 * - «Pago seguro con» y el logo oficial de Mercado Pago (asset del kit de
 *   marca, en public/), en una sola línea. Si el logo no carga, en su lugar
 *   va el texto «Mercado Pago».
 * - Las tarjetas que acepta la cuenta, con las imágenes que sirve Mercado
 *   Pago (no guardamos copias de las marcas). Al escribir el número, la
 *   marca detectada se resalta y las demás se atenúan.
 * - Imágenes con tamaño fijo y carga diferida (no mueven el formulario ni
 *   compiten con el LCP). Sin scripts nuevos.
 */
export function SelloPagoSeguro({
  tarjetas,
  marcaDetectada,
}: Readonly<{
  tarjetas: readonly TarjetaAceptada[];
  marcaDetectada: string | null;
}>) {
  const [sinLogo, setSinLogo] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-[0.75rem] border border-culinary-neutral/20 bg-white px-4 py-3">
      {/* Una sola línea: «Pago seguro con» y el logo, que completa la frase
          (el lector de pantalla lee «Pago seguro con Mercado Pago»). El SVG
          trae su propio margen: el -ml lo acerca al texto sin recortarlo. */}
      <p className="flex items-center gap-1 text-sm font-semibold text-foreground">
        <span
          className="material-symbols-outlined text-[20px] text-[#1b6b3a]"
          aria-hidden="true"
        >
          lock
        </span>
        {TEXTO_PAGO_SEGURO}
        {sinLogo ? (
          <span>Mercado Pago</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={LOGO_MERCADO_PAGO}
            alt="Mercado Pago"
            width={99}
            height={40}
            decoding="async"
            ref={siYaFallo(() => setSinLogo(true))}
            onError={() => setSinLogo(true)}
            className="-my-2 -ml-2 h-10 w-auto flex-none"
          />
        )}
      </p>
      {tarjetas.length > 0 && (
        <ul
          aria-label={NOMBRE_TARJETAS_ACEPTADAS}
          className="flex flex-wrap gap-2 border-t border-culinary-neutral/15 pt-3"
        >
          {tarjetas.map((tarjeta) => (
            <Tarjeta
              key={tarjeta.id}
              tarjeta={tarjeta}
              estado={estadoDeTarjeta(tarjeta, marcaDetectada)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
