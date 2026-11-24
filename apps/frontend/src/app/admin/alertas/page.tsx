import { ListaAlertas } from '@/components/alertas/ListaAlertas';

// BL-441: pantalla Alertas del menú. Lista los llamados de mesa y los avisos
// de pago en efectivo pendientes, la más antigua primero, con los mismos
// botones que la vista rápida de la campana. BL-470: para el Administrador
// suma la sección Stock, igual que la campana. El estado sale de
// AlertasProvider (el único socket del staff dentro de /admin/*), sin guard de
// rol propio porque hereda el de admin/layout.tsx (ADMIN o MOZO).
//
// El ancho máximo de la lista lo pone ListaAlertas en la lista misma: así el
// aviso de «no hay alertas» se centra en todo el contenido y no en una
// columna angosta pegada a la izquierda.
export default function AdminAlertasPage() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div>
        <h1 className="text-headline-lg text-primary">Alertas</h1>
        <p className="text-body-md text-on-surface-variant">
          Las mesas que llamaron al mozo o quieren pagar en efectivo, la más
          antigua primero. Si sos Administrador, también los ítems agotados o
          por agotarse.
        </p>
      </div>
      <ListaAlertas />
    </div>
  );
}
