import { KdsBoard } from '@/components/kds/KdsBoard';

// Misma pantalla que /kds (standalone, pantalla completa — pensada para la
// estación física de Cocina), pero embebida dentro del shell de /admin (con
// sidebar) para que ADMIN/MOZO puedan verla y operarla sin salir de admin.
// Reutiliza <KdsBoard /> tal cual: mismo nivel de interacción (transición
// de pedidos), sin guard de rol propio porque ya hereda el de
// admin/layout.tsx (esStaff = ADMIN o MOZO) — COCINA nunca entra acá, sigue
// usando /kds standalone.
export default function AdminKdsPage() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div>
        <h1 className="text-headline-lg text-primary">Pedidos activos</h1>
        <p className="text-body-md text-on-surface-variant">
          Los pedidos se agrupan por mesa y se actualizan automáticamente.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <KdsBoard />
      </div>
    </div>
  );
}