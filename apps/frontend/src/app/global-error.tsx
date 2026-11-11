"use client";

import localFont from "next/font/local";
import { PantallaDeError } from "@/components/error/PantallaDeError";
import "./globals.css";

/**
 * BL-517: página de error cuando falla el layout raíz (layout.tsx: los
 * providers, Faro o VersionInfo). Reemplaza la página entera, así que trae su
 * propio <html> y <body>, los estilos globales y la misma tipografía que el
 * layout. Next solo la usa en producción; en desarrollo se ve el overlay de
 * errores.
 */
const plusJakarta = localFont({
  src: "./fonts/plus-jakarta-sans-latin-wght-normal.woff2",
  weight: "200 800",
  style: "normal",
  display: "swap",
});

interface ErrorGlobalProps {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}

export default function ErrorGlobal({ error, reset }: ErrorGlobalProps) {
  return (
    <html lang="es">
      <body className={`${plusJakarta.className} antialiased`}>
        <PantallaDeError error={error} onReintentar={reset} />
      </body>
    </html>
  );
}
