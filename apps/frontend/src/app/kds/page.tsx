import { KdsBoard } from '@/components/kds/KdsBoard';

export default function KdsPage() {
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