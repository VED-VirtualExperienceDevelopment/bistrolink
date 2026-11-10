import type { Pedido } from '@/types/pedido';
import { etiquetaEstadoConCola } from './cola-kds.utils';
import { sePuedeCancelar } from './cancelacion.utils';
import {
  ETIQUETA_NIVEL_ESPERA,
  UMBRALES_ESPERA_POR_DEFECTO,
  minutosDeEspera,
  nivelDeEspera,
  textoEspera,
  type NivelEspera,
  type UmbralesEspera,
} from './espera-kds.utils';

interface OrderTicketProps {
  pedido: Pedido;
  puedeOperarTransiciones: boolean;
  onTransicion: (pedidoId: string, nuevoEstado: Pedido['estado']) => void;
  /** HU-038 (BL-208): hora actual del reloj del tablero (ms epoch). */
  ahora: number;
  /** HU-038 (BL-208): umbrales de espera del local (por defecto 30/60/120 min). */
  umbrales?: UmbralesEspera;
  /** HU-042 (BL-466): cola automática activa en el local. */
  colaActiva?: boolean;
  /** HU-042 (BL-466): lugar en la cola (1 = el próximo), si está en espera. */
  posicionEnCola?: number | null;
  /** HU-024 (BL-104): abre la cancelación del pedido (mozo y admin). */
  onCancelar?: (pedido: Pedido) => void;
}

// Etiqueta legible para mostrar en el badge — separada del valor real del
// tipo (que es el enum PedidoEstado de Prisma). Cambiar esto no afecta
// ninguna comparación de estado, solo el texto que ve el usuario.
export const ESTADO_LABEL: Record<Pedido['estado'], string> = {
  PENDIENTE_PAGO: 'Esperando el pago',
  RECIBIDO: 'Recibido',
  EN_PREPARACION: 'En preparación',
  LISTO_PARA_ENTREGAR: 'Listo para entregar',
  ENTREGADO: 'Entregado',
  CANCELADO: 'Cancelado',
};

// HU-038 (BL-208): colores del encabezado por nivel de espera. Cada par
// fondo/texto cumple WCAG 2.1 AA (4,5:1 o más). «Atención» antes usaba texto
// blanco sobre dorado (2,3:1); ahora usa on-tertiary-container (4,5:1).
const ESTILO_NIVEL: Record<NivelEspera, { encabezado: string; borde: string }> = {
  'a-tiempo': { encabezado: 'bg-primary text-on-primary', borde: '' },
  atencion: {
    encabezado: 'bg-tertiary-container text-on-tertiary-container',
    borde: '',
  },
  demorado: { encabezado: 'bg-error text-on-error', borde: '' },
  // Demora alta: más oscuro que «Demorado» y con un borde grueso, para que se
  // distinga de lejos. El texto «Demora alta» es lo que lo identifica.
  'demora-alta': {
    encabezado: 'bg-on-error-container text-on-error',
    borde: 'ring-4 ring-error',
  },
};

function formatHora(iso: string) {
  return new Date(iso).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });
}

export function OrderTicket({
  pedido,
  puedeOperarTransiciones,
  onTransicion,
  ahora,
  umbrales = UMBRALES_ESPERA_POR_DEFECTO,
  colaActiva = false,
  posicionEnCola = null,
  onCancelar,
}: Readonly<OrderTicketProps>) {
  const minutos = minutosDeEspera(pedido.createdAt, ahora);
  const nivel = nivelDeEspera(minutos, umbrales);
  const estilo = ESTILO_NIVEL[nivel];
  const lineas = pedido.lineas ?? [];
  const etiquetaEstado = etiquetaEstadoConCola(
    pedido.estado,
    ESTADO_LABEL[pedido.estado],
    colaActiva,
  );
  // HU-042 (BL-466): con la cola activa, el pedido en espera pasa a
  // preparación solo cuando se libera un lugar. El pase manual con la cocina
  // llena el backend lo rechaza, así que el botón no se muestra.
  const esperaLugar = pedido.estado === 'RECIBIDO' && colaActiva;

  return (
    <article
      data-testid="pedido-kds"
      data-pedido-id={pedido.id}
      data-nivel-espera={nivel}
      className={`flex h-full w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm ${estilo.borde}`}
    >
      {/* Header del ticket. HU-038 (BL-208): el tiempo de espera va grande
          para leerlo a 2 metros; la hora de llegada queda como dato
          secundario. */}
      <div className={`${estilo.encabezado} flex shrink-0 items-start justify-between gap-2 p-3`}>
        <div className="min-w-0">
          <div className="text-headline-sm font-bold">Mesa {pedido.mesaNumero}</div>
          <div data-testid="nivel-espera" className="text-label-lg font-bold">
            {nivel === 'demora-alta' && <span aria-hidden="true">⚠ </span>}
            {ETIQUETA_NIVEL_ESPERA[nivel]}
          </div>
        </div>
        <div className="text-right">
          <div data-testid="tiempo-espera" className="text-headline-md font-bold">
            {textoEspera(minutos)}
          </div>
          <div className="text-label-md">Llegó {formatHora(pedido.createdAt)}</div>
          <div className="mt-1 inline-block rounded border border-current px-2 py-0.5 text-label-md font-semibold">
            {etiquetaEstado}
          </div>
          {posicionEnCola !== null && (
            <div
              data-testid="posicion-cola"
              className="mt-1 text-label-md font-semibold"
            >
              N.º {posicionEnCola} en la cola
            </div>
          )}
        </div>
      </div>

      {/* Observación general del pedido (HU-021, cuando exista) */}
      {pedido.observacionGeneral && (
        <div className="shrink-0 border-b border-outline-variant bg-error-container px-3 py-2 text-body-sm text-on-error-container">
          ⚠ {pedido.observacionGeneral}
        </div>
      )}

      {/* Ítems */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {lineas.map((linea) => (
          <div key={linea.id} className="border-b border-surface-variant pb-3 last:border-0">
            <div className="flex items-center gap-2 text-body-lg font-semibold">
              <span className="font-bold text-primary">{linea.cantidad}x</span>
              {linea.nombreSnapshot}
            </div>
            {linea.observacion && (
              <div className="mt-1 border-l-2 border-error pl-2 text-body-sm font-semibold text-error">
                {linea.observacion}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Transiciones de estado (RD.06: Cocina es de solo lectura — estos
          botones no se renderizan si el rol autenticado es solo Cocina.
          El backend igual rechaza el evento si el rol no corresponde;
          esto es defensa en profundidad de la UI, no la única validación). */}
      {puedeOperarTransiciones && esperaLugar && (
        <p className="shrink-0 border-t border-outline-variant p-3 text-center text-body-sm text-on-surface-variant">
          Pasa a preparación cuando se libere un lugar.
        </p>
      )}
      {puedeOperarTransiciones && !esperaLugar && (
        <div className="shrink-0 border-t border-outline-variant p-3">
          {pedido.estado === 'RECIBIDO' && (
            <button
              type="button"
              onClick={() => onTransicion(pedido.id, 'EN_PREPARACION')}
              className="w-full rounded-lg bg-tertiary-container py-2.5 text-label-lg font-semibold text-on-tertiary-container transition-colors hover:opacity-90"
            >
              Marcar en preparación
            </button>
          )}
          {pedido.estado === 'EN_PREPARACION' && (
            <button
              type="button"
              onClick={() => onTransicion(pedido.id, 'LISTO_PARA_ENTREGAR')}
              className="w-full rounded-lg bg-primary py-2.5 text-label-lg font-semibold text-on-primary transition-colors hover:opacity-90"
            >
              Listo para entregar
            </button>
          )}
          {pedido.estado === 'LISTO_PARA_ENTREGAR' && (
            <button
              type="button"
              onClick={() => onTransicion(pedido.id, 'ENTREGADO')}
              className="w-full rounded-lg bg-secondary py-2.5 text-label-lg font-semibold text-on-secondary transition-colors hover:opacity-90"
            >
              Marcar como entregado
            </button>
          )}
        </div>
      )}
      {/* HU-024 (BL-104): cancelar un pedido recibido o en preparación. */}
      {puedeOperarTransiciones && onCancelar && sePuedeCancelar(pedido.estado) && (
        <div className="shrink-0 px-3 pb-3">
          <button
            type="button"
            onClick={() => onCancelar(pedido)}
            className="min-h-12 w-full rounded-lg text-label-lg text-error hover:bg-error-container/40"
          >
            Cancelar pedido{' '}
            <span className="sr-only">de la mesa {pedido.mesaNumero}</span>
          </button>
        </div>
      )}
    </article>
  );
}
