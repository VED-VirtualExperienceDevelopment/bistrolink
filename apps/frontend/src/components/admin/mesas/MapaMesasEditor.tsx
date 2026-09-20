'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { io, type Socket } from 'socket.io-client';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { apiFetch, ApiError } from '@/lib/api-client';
import { MesaShape } from './MesaShape';
import {
  aGuardarLayoutItems,
  mesasConLayoutAEdicion,
  normalizarRotacion,
  nuevaMesaEnEdicion,
  numerosDuplicados,
  siguienteNumeroDisponible,
  type MesaEnEdicion,
} from './mapa-mesas.utils';
import type {
  GuardarLayoutPayload,
  MesaConLayout,
  MesaEstadoActualizadoPayload,
} from '@/types/mesa';

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const ALTURA_STAGE = 600;

interface Props {
  restauranteId: string;
}

/**
 * BL-160: editor visual del mapa de mesas, sobre Konva/react-konva.
 *
 * Este componente es un client component "hoja" (sin lógica de routing ni
 * de resolución de restauranteId — eso lo maneja la página, mismo patrón que
 * usuarios/page.tsx delegando restauranteId a sus diálogos). Se monta
 * siempre vía `next/dynamic(..., { ssr: false })` desde la página: Konva
 * toca `window`/`document` al importarse, y un intento de SSR revienta el
 * build de Next.
 *
 * Restricción por rol (checklist BL-160): Administrador edita todo,
 * Colaborador (MOZO) es de solo lectura — ni drag, ni resize/rotate, ni
 * edición del número, ni los botones de agregar/eliminar/guardar. La
 * lectura en sí (GET /mesas/layout) ya la permite el backend a ambos roles.
 */
export function MapaMesasEditor({ restauranteId }: Props) {
  const { token, hasRole } = useKeycloakAuth();
  const puedeEditar = hasRole('ADMIN');

  const [mesas, setMesas] = useState<MesaEnEdicion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [guardando, setGuardando] = useState(false);
  const [guardadoError, setGuardadoError] = useState<string | null>(null);
  const [guardadoOk, setGuardadoOk] = useState(false);

  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [editandoNumero, setEditandoNumero] = useState<{ clientId: string; valor: string } | null>(
    null,
  );

  const contenedorRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef(new Map<string, Konva.Group>());
  const socketRef = useRef<Socket | null>(null);
  const [anchoStage, setAnchoStage] = useState(800);

  // --- Carga inicial: GET /mesas/layout -------------------------------------
  const cargarLayout = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<MesaConLayout[]>(
        `/mesas/layout?restauranteId=${restauranteId}`,
        token,
      );
      setMesas(mesasConLayoutAEdicion(data));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'No se pudo cargar el mapa de mesas');
    } finally {
      setLoading(false);
    }
  }, [token, restauranteId]);

  useEffect(() => {
    cargarLayout();
  }, [cargarLayout]);

  // --- Tamaño responsive del canvas ------------------------------------------
  // Konva necesita un width/height explícito en píxeles — no se adapta solo
  // por CSS como un <div>. Se mide el contenedor con ResizeObserver en vez
  // de fijar un ancho a mano, para que el mapa aproveche todo el panel de
  // admin en cualquier tamaño de pantalla.
  useEffect(() => {
    const contenedor = contenedorRef.current;
    if (!contenedor) return;
    const observer = new ResizeObserver((entries) => {
      const ancho = entries[0]?.contentRect.width;
      if (ancho) setAnchoStage(Math.floor(ancho));
    });
    observer.observe(contenedor);
    return () => observer.disconnect();
  }, []);

  // --- WebSocket: estado de ocupación en vivo ---------------------------------
  // Se suscribe al evento real que ya emite KdsGateway.emitirEstadoMesa
  // (backend de HU-016). Lo único "mock" hoy es QUIÉN lo dispara: el único
  // emisor que existe todavía es el endpoint provisorio
  // PATCH /mesas/:id/estado, porque HU-017 (el flujo real de pedidos/pagos)
  // no está implementado. La suscripción de acá no cambia el día que
  // HU-017 empiece a emitirlo — es el mismo evento, mismo payload.
  useEffect(() => {
    if (!token) return;

    const socket = io(WS_URL, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('mesa:estado_actualizado', (payload: MesaEstadoActualizadoPayload) => {
      setMesas((prev) =>
        prev.map((m) => (m.id === payload.mesaId ? { ...m, estado: payload.estado } : m)),
      );
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  // --- Transformer: sigue a la mesa seleccionada ------------------------------
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (!seleccionada || !puedeEditar) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const nodo = shapeRefs.current.get(seleccionada);
    if (nodo) {
      tr.nodes([nodo]);
      tr.getLayer()?.batchDraw();
    }
  }, [seleccionada, puedeEditar, mesas.length]);

  // El mensaje de "Guardado" no debe quedar pegado para siempre.
  useEffect(() => {
    if (!guardadoOk) return;
    const id = setTimeout(() => setGuardadoOk(false), 3000);
    return () => clearTimeout(id);
  }, [guardadoOk]);

  const nodoEditandoNumero = editandoNumero
    ? shapeRefs.current.get(editandoNumero.clientId)
    : undefined;
  const posicionInputNumero = nodoEditandoNumero?.getAbsolutePosition();

  // El círculo solo debe poder resizearse manteniendo la proporción (si no,
  // arrastrar una esquina lo convierte en óvalo) — el rectángulo sí permite
  // ancho y alto independientes, como cualquier resize normal.
  const formaSeleccionada = mesas.find((m) => m.clientId === seleccionada)?.forma;
  const esCirculoSeleccionado = formaSeleccionada === 'CIRCULO';

  const duplicados = useMemo(() => numerosDuplicados(mesas), [mesas]);

  // --- Handlers de edición -----------------------------------------------------
  function actualizarMesa(clientId: string, cambios: Partial<MesaEnEdicion>) {
    setMesas((prev) => prev.map((m) => (m.clientId === clientId ? { ...m, ...cambios } : m)));
  }

  function handleAgregarMesa() {
    const clientId = `nueva-${crypto.randomUUID()}`;
    const numero = siguienteNumeroDisponible(mesas);
    setMesas((prev) => [...prev, nuevaMesaEnEdicion(clientId, numero, prev.length)]);
    setSeleccionada(clientId);
  }

  function handleEliminarSeleccionada() {
    if (!seleccionada) return;
    setMesas((prev) => prev.filter((m) => m.clientId !== seleccionada));
    setSeleccionada(null);
  }

  function handleClickStage(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    // Clic en el fondo del Stage (no en una mesa) deselecciona — mismo
    // criterio de "target === currentTarget" que ya usa Dialog.tsx para
    // distinguir clic en el fondo de clic en un hijo.
    if (e.target === e.target.getStage()) {
      setSeleccionada(null);
    }
  }

  function confirmarEdicionNumero() {
    if (!editandoNumero) return;
    const nuevoNumero = Number.parseInt(editandoNumero.valor, 10);
    if (Number.isFinite(nuevoNumero) && nuevoNumero > 0) {
      actualizarMesa(editandoNumero.clientId, { numero: nuevoNumero });
    }
    setEditandoNumero(null);
  }

  // --- Guardado: POST /mesas/layout ---------------------------------------------
  async function handleGuardar() {
    if (!token || duplicados.length > 0) return;
    setGuardando(true);
    setGuardadoError(null);
    setGuardadoOk(false);
    try {
      const payload: GuardarLayoutPayload = {
        restauranteId,
        mesas: aGuardarLayoutItems(mesas),
      };
      await apiFetch('/mesas/layout', token, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setGuardadoOk(true);
      // Trae los id reales que Prisma asignó a las mesas nuevas — sin esto,
      // un segundo guardado las volvería a crear en vez de actualizarlas
      // (guardarLayout crea cuando el item no trae `id`).
      await cargarLayout();
    } catch (err) {
      setGuardadoError(err instanceof ApiError ? err.message : 'No se pudo guardar el mapa');
    } finally {
      setGuardando(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
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

  return (
    <div className="space-y-4">
      {!puedeEditar && (
        <div role="status" className="rounded-lg bg-surface-container-low px-4 py-2 text-label-md text-on-surface-variant">
          Estás viendo el mapa en modo solo lectura. Solo un Administrador puede editarlo.
        </div>
      )}

      {puedeEditar && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAgregarMesa}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-body-md font-medium text-on-primary hover:opacity-90"
            >
              <span className="material-symbols-outlined text-[20px]">add</span>
              Agregar mesa
            </button>
            <button
              type="button"
              onClick={handleEliminarSeleccionada}
              disabled={!seleccionada}
              className="flex items-center gap-2 rounded-lg border border-outline-variant px-4 py-2 text-body-md text-on-surface-variant hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[20px]">delete</span>
              Eliminar mesa
            </button>
            <p className="text-label-sm text-on-surface-variant">
              Doble clic en una mesa para editar su número.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {duplicados.length > 0 && (
              <p role="alert" className="text-label-md text-error">
                Números repetidos: {duplicados.join(', ')}
              </p>
            )}
            {guardadoError && (
              <p role="alert" className="text-label-md text-error">
                {guardadoError}
              </p>
            )}
            {guardadoOk && <p className="text-label-md text-primary">Guardado ✓</p>}
            <button
              type="button"
              onClick={handleGuardar}
              disabled={guardando || duplicados.length > 0}
              className="rounded-lg bg-primary px-4 py-2 text-body-md font-medium text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Guardar mapa'}
            </button>
          </div>
        </div>
      )}

      <div
        ref={contenedorRef}
        className="relative w-full overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest"
      >
        <Stage
          width={anchoStage}
          height={ALTURA_STAGE}
          onMouseDown={handleClickStage}
          onTouchStart={handleClickStage}
        >
          <Layer>
            {mesas.map((mesa) => (
              <MesaShape
                key={mesa.clientId}
                ref={(nodo) => {
                  if (nodo) shapeRefs.current.set(mesa.clientId, nodo);
                  else shapeRefs.current.delete(mesa.clientId);
                }}
                numero={mesa.numero}
                estado={mesa.estado}
                x={mesa.x}
                y={mesa.y}
                forma={mesa.forma}
                ancho={mesa.ancho}
                alto={mesa.alto}
                rotacion={mesa.rotacion}
                seleccionada={mesa.clientId === seleccionada}
                editable={puedeEditar}
                onSeleccionar={() => setSeleccionada(mesa.clientId)}
                onArrastrar={(x, y) => actualizarMesa(mesa.clientId, { x, y })}
                onTransformar={(cambios) =>
                  actualizarMesa(mesa.clientId, {
                    ...cambios,
                    rotacion: normalizarRotacion(cambios.rotacion),
                  })
                }
                onEditarNumero={() => {
                  setSeleccionada(mesa.clientId);
                  setEditandoNumero({ clientId: mesa.clientId, valor: String(mesa.numero) });
                }}
              />
            ))}
            {puedeEditar && (
              <Transformer
                ref={transformerRef}
                rotateEnabled
                keepRatio={esCirculoSeleccionado}
                enabledAnchors={
                  esCirculoSeleccionado
                    ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
                    : undefined
                }
                boundBoxFunc={(oldBox, newBox) =>
                  newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
                }
              />
            )}
          </Layer>
        </Stage>

        {editandoNumero && posicionInputNumero && (
          <input
            type="number"
            min={1}
            autoFocus
            value={editandoNumero.valor}
            onChange={(e) => setEditandoNumero({ ...editandoNumero, valor: e.target.value })}
            onBlur={confirmarEdicionNumero}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmarEdicionNumero();
              if (e.key === 'Escape') setEditandoNumero(null);
            }}
            className="absolute z-10 w-14 rounded border border-primary bg-surface px-1 py-0.5 text-center text-body-sm text-on-surface shadow-md outline-none"
            style={{
              left: posicionInputNumero.x - 28,
              top: posicionInputNumero.y - 14,
            }}
          />
        )}
      </div>
    </div>
  );
}