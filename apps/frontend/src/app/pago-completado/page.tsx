import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Pago completado' };

export default function PagoCompletadoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <section className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-8 text-center shadow-sm">
        <span
          className="material-symbols-outlined text-5xl text-primary"
          aria-hidden="true"
        >
          check_circle
        </span>
        <h1 className="mt-4 text-2xl font-bold text-on-surface">
          ¡Pago recibido!
        </h1>
        <p className="mt-2 text-on-surface-variant">
          Estamos confirmando tu pago. En unos instantes se emite tu comprobante
          electrónico. Ya podés cerrar esta pantalla.
        </p>
      </section>
    </main>
  );
}