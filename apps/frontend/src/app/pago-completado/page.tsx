import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Verificando tu pago' };

// Plexo redirige acá (defaultUrl) tanto si el pago se aprobó como si la
// tarjeta fue rechazada: la URL no dice cómo terminó el cobro. Por eso esta
// pantalla NO afirma que el pago salió bien; el resultado real lo define el
// webhook de Plexo en el backend.
export default function PagoCompletadoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <section className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-8 text-center shadow-sm">
        <span
          className="material-symbols-outlined text-5xl text-primary"
          aria-hidden="true"
        >
          hourglass_top
        </span>
        <h1 className="mt-4 text-2xl font-bold text-on-surface">
          Estamos verificando tu pago
        </h1>
        <p className="mt-2 text-on-surface-variant">
          Si el pago fue aprobado, en unos instantes se emite tu comprobante
          electrónico.
        </p>
        <p className="mt-2 text-on-surface-variant">
          Si tu tarjeta fue rechazada, no se realizó ningún cobro: volvé al
          menú e intentá nuevamente.
        </p>
      </section>
    </main>
  );
}