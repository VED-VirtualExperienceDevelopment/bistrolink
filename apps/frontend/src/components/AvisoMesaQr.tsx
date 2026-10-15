interface AvisoMesaQrProps {
  readonly icono: string;
  readonly titulo: string;
  readonly detalle: string;
}

/**
 * HU-034 (BL-204): aviso a pantalla completa cuando no se puede mostrar el
 * menú de una mesa (QR no válido, QR reemplazado o enlace viejo por ids).
 * Sin estado ni efectos: sirve tanto en Server como en Client Components.
 */
export default function AvisoMesaQr({ icono, titulo, detalle }: AvisoMesaQrProps) {
  return (
    <main className="flex min-h-screen items-center justify-center p-8 bg-culinary-background">
      <div className="text-center bg-white p-8 rounded-[1rem] border border-culinary-neutral/10 shadow-sm max-w-md">
        <div className="text-4xl mb-4" aria-hidden="true">
          {icono}
        </div>
        <p className="text-lg font-medium text-culinary-on-surface">{titulo}</p>
        <p className="text-sm text-culinary-neutral mt-2">{detalle}</p>
      </div>
    </main>
  );
}
