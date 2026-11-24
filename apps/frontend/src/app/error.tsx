"use client";

import { PantallaDeError } from "@/components/error/PantallaDeError";

interface ErrorDeLaAppProps {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}

/**
 * BL-517: página de error de las páginas de la app. El contenido y la lógica
 * (recarga única ante un error de chunk y aviso a Faro) están en
 * PantallaDeError, que comparte con global-error.tsx.
 */
export default function ErrorDeLaApp({ error, reset }: ErrorDeLaAppProps) {
  return <PantallaDeError error={error} onReintentar={reset} />;
}
