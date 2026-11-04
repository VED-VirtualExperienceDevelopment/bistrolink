import { ListaAlertas } from '@/components/alertas/ListaAlertas';

// BL-441: pantalla Alertas del menú. Lista los llamados de mesa y los avisos
// de pago en efectivo pendientes, la más antigua primero, con los mismos
// botones que la vista rápida de la campana. El estado sale de
// AlertasProvider (el único socket del staff dentro de /admin/*), sin guard de
// rol propio porque hereda el de admin/layout.tsx (ADMIN o MOZO).
export default function AdminAlertasPage() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div>
        <h1 className="text-headline-lg text-primary">Alertas</h1>
        <p className="text-body-md text-on-surface-variant">
          Las mesas que llamaron al mozo o quieren pagar en efectivo, la más
          antigua primero.
        </p>
      </div>
      <div className="w-full max-w-2xl">
        <ListaAlertas />
      </div>
    </div>
  );
}
