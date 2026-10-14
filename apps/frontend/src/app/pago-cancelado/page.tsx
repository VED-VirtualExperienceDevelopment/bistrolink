import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Pago cancelado' };

export default function PagoCanceladoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <section className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-8 text-center shadow-sm">
        <span
          className="material-symbols-outlined text-5xl text-error"
          aria-hidden="true"
        >
          cancel
        </span>
        <h1 className="mt-4 text-2xl font-bold text-on-surface">
          Pago cancelado
        </h1>
        <p className="mt-2 text-on-surface-variant">
          No se realizó ningún cobro. Si querés, volvé a escanear el QR de tu
          mesa e intentá nuevamente.
        </p>
      </section>
    </main>
  );
}