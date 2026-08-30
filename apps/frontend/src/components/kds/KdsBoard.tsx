'use client';

import { useEffect, useState } from 'react';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { apiFetch, ApiError } from '@/lib/api-client';
import { OrderTicket } from './OrderTicket';
import type { Pedido } from '@/types/pedido';

export function KdsBoard() {
  const { token } = useKeycloakAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    // Carga inicial vía REST. La actualización en tiempo real (WebSocket)
    // se agrega en el siguiente sub-issue — por ahora esta vista solo
    // pinta el estado actual al montar/refrescar.
    apiFetch<Pedido[]>('/pedidos/activos', token)
      .then(setPedidos)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'No se pudieron cargar los pedidos'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
        {loadError}
      </div>
    );
  }

  if (pedidos.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-body-md text-on-surface-variant">
        No hay pedidos activos en este momento.
      </div>
    );
  }

  return (
    <div className="flex h-full gap-gutter overflow-x-auto overflow-y-hidden pb-4">
      {pedidos.map((pedido) => (
        <OrderTicket key={pedido.id} pedido={pedido} />
      ))}
    </div>
  );
}