import {
  TEXTO_ESTADO_CONEXION,
  type EstadoConexion,
} from './estado-conexion.utils';

interface IndicadorConexionProps {
  estado: EstadoConexion;
  /** Texto del estado conectado. El comensal ve «En vivo». */
  textoConectado?: string;
  /** Más chico, para pantallas del comensal. */
  compacto?: boolean;
  className?: string;
}

// Cada par fondo/texto cumple WCAG 2.1 AA. El punto es decorativo: el estado
// lo dice el texto (WCAG 1.4.1).
const ESTILO: Record<EstadoConexion, { caja: string; punto: string }> = {
  conectando: {
    caja: 'bg-surface-container text-on-surface',
    punto: 'bg-on-surface-variant motion-safe:animate-pulse',
  },
  conectado: {
    caja: 'bg-surface-container text-on-surface',
    punto: 'bg-primary',
  },
  reconectando: {
    caja: 'bg-tertiary-container text-on-tertiary-container',
    punto: 'bg-on-tertiary-container motion-safe:animate-pulse',
  },
  desconectado: {
    caja: 'bg-error-container text-on-error-container',
    punto: 'bg-error',
  },
};

/**
 * HU-038 (BL-504): indicador de la conexión en tiempo real. Es un <output>
 * (rol «status»): el lector de pantalla anuncia los cambios sin mover el
 * foco. El estado lo calcula useEstadoConexion.
 */
export function IndicadorConexion({
  estado,
  textoConectado = TEXTO_ESTADO_CONEXION.conectado,
  compacto = false,
  className = '',
}: Readonly<IndicadorConexionProps>) {
  const texto =
    estado === 'conectado' ? textoConectado : TEXTO_ESTADO_CONEXION[estado];
  const tamano = compacto
    ? 'gap-1.5 px-2 py-0.5 text-label-md'
    : 'gap-2 px-3 py-1 text-label-lg';

  return (
    <output
      data-testid="indicador-conexion"
      data-estado={estado}
      className={`inline-flex items-center rounded-full font-semibold ${tamano} ${ESTILO[estado].caja} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${ESTILO[estado].punto}`}
      />
      {texto}
    </output>
  );
}
