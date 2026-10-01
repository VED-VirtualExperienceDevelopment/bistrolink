"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import { io, type Socket } from "socket.io-client";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import { MesaShape } from "./MesaShape";
import {
  aGuardarLayoutItems,
  anchoNecesarioLienzo,
  aplicarEstadoMesa,
  cambiarForma,
  idsAEliminar,
  DIMENSION_MAXIMA_MESA,
  DIMENSION_MINIMA_MESA,
  limitarCentro,
  mesasConLayoutAEdicion,
  normalizarRotacion,
  nuevaMesaEnEdicion,
  numerosDuplicados,
  parsearNumeroMesa,
  puedeEditarMapa,
  puedeEliminarMesa,
  quitarMesa,
  reubicarFueraDelLienzo,
  semiExtension,
  siguienteNumeroDisponible,
  type Lienzo,
  type MesaEnEdicion,
} from "./mapa-mesas.utils";
import type {
  FormaMesa,
  GuardarLayoutPayload,
  MesaConLayout,
  MesaEstadoActualizadoPayload,
} from "@/types/mesa";

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const ALTURA_STAGE = 600;

const OPCIONES_FORMA: { forma: FormaMesa; etiqueta: string; icono: string }[] =
  [
    { forma: "CIRCULO", etiqueta: "Círculo", icono: "circle" },
    { forma: "CUADRADO", etiqueta: "Cuadrado", icono: "square" },
    { forma: "RECTANGULO", etiqueta: "Rectángulo", icono: "rectangle" },
  ];

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
export function MapaMesasEditor({ restauranteId }: Readonly<Props>) {
  const { token, hasRole } = useKeycloakAuth();
  const puedeEditar = puedeEditarMapa(hasRole);

  const [mesas, setMesas] = useState<MesaEnEdicion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Mesas que se trajeron al área visible al cargar (estaban fuera del lienzo).
  const [reubicadas, setReubicadas] = useState(0);

  const [guardando, setGuardando] = useState(false);
  const [guardadoError, setGuardadoError] = useState<string | null>(null);
  const [guardadoOk, setGuardadoOk] = useState(false);

  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  // BL-58: mesas ya guardadas que el administrador quitó del mapa y que se
  // borran en el próximo guardado. Se guarda la mesa completa (no solo el
  // id) para poder devolverla al mapa si el guardado falla.
  const [eliminadas, setEliminadas] = useState<MesaEnEdicion[]>([]);
  const [editandoNumero, setEditandoNumero] = useState<{
    clientId: string;
    valor: string;
  } | null>(null);

  const contenedorRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef(new Map<string, Konva.Group>());
  const socketRef = useRef<Socket | null>(null);
  const inputNumeroRef = useRef<HTMLInputElement>(null);
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
      const cargadas = reubicarFueraDelLienzo(
        mesasConLayoutAEdicion(data),
        ALTURA_STAGE,
      );
      setMesas(cargadas.mesas);
      setReubicadas(cargadas.reubicadas);
    } catch (err) {
      setLoadError(
        err instanceof ApiError
          ? err.message
          : "No se pudo cargar el mapa de mesas",
      );
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
  //
  // Depende de `loading`: mientras carga se renderiza el spinner y el
  // contenedor todavía no existe, así que con [] el efecto corría una sola
  // vez con contenedorRef en null y el canvas quedaba fijo en 800 px.
  useEffect(() => {
    const contenedor = contenedorRef.current;
    if (!contenedor) return;
    const observer = new ResizeObserver((entries) => {
      const ancho = entries[0]?.contentRect.width;
      if (ancho) setAnchoStage(Math.floor(ancho));
    });
    observer.observe(contenedor);
    return () => observer.disconnect();
  }, [loading]);

  // El lienzo es al menos tan ancho como el contenedor, y se ensancha si
  // alguna mesa quedó más a la derecha (salón guardado en una pantalla más
  // ancha): en ese caso aparece scroll horizontal en vez de esconderla.
  const lienzo: Lienzo = useMemo(
    () => ({
      ancho: Math.max(anchoStage, anchoNecesarioLienzo(mesas)),
      alto: ALTURA_STAGE,
    }),
    [anchoStage, mesas],
  );

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

    socket.on(
      "mesa:estado_actualizado",
      (payload: MesaEstadoActualizadoPayload) => {
        setMesas((prev) => aplicarEstadoMesa(prev, payload));
      },
    );

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
      // Al cambiar la forma (o el tamaño) de la mesa seleccionada, el
      // recuadro del Transformer tiene que recalcularse sobre la figura nueva.
      tr.forceUpdate();
      tr.getLayer()?.batchDraw();
    }
  }, [seleccionada, puedeEditar, mesas]);

  // El mensaje de "Guardado" no debe quedar pegado para siempre.
  useEffect(() => {
    if (!guardadoOk) return;
    const id = setTimeout(() => setGuardadoOk(false), 3000);
    return () => clearTimeout(id);
  }, [guardadoOk]);

  // Foco automático del input de número al editar (Sonar: el atributo JSX
  // `autoFocus` está desaconsejado por accesibilidad -- roba el foco sin que
  // el usuario lo pida, y puede desorientar a quien navega con lector de
  // pantalla. Enfocarlo a mano en un efecto, atado a la apertura del editor,
  // logra el mismo comportamiento (foco inmediato al hacer doble clic en una
  // mesa) sin el lint warning.
  useEffect(() => {
    if (editandoNumero) {
      inputNumeroRef.current?.focus();
    }
  }, [editandoNumero]);

  const nodoEditandoNumero = editandoNumero
    ? shapeRefs.current.get(editandoNumero.clientId)
    : undefined;
  const posicionInputNumero = nodoEditandoNumero?.getAbsolutePosition();

  // El círculo y el cuadrado solo deben poder resizearse manteniendo la
  // proporción (si no, arrastrar una esquina convierte el círculo en óvalo y
  // el cuadrado en rectángulo) — el rectángulo sí permite ancho y alto
  // independientes, como cualquier resize normal.
  const mesaSeleccionada = mesas.find((m) => m.clientId === seleccionada);
  const formaSeleccionada = mesaSeleccionada?.forma;
  const mantieneProporcion =
    formaSeleccionada === "CIRCULO" || formaSeleccionada === "CUADRADO";

  const duplicados = useMemo(() => numerosDuplicados(mesas), [mesas]);

  // --- Handlers de edición -----------------------------------------------------
  function actualizarMesa(clientId: string, cambios: Partial<MesaEnEdicion>) {
    setMesas((prev) =>
      prev.map((m) => (m.clientId === clientId ? { ...m, ...cambios } : m)),
    );
  }

  function handleAgregarMesa() {
    const clientId = `nueva-${crypto.randomUUID()}`;
    const numero = siguienteNumeroDisponible(mesas);
    setMesas((prev) => {
      // A partir de la sexta fila, la grilla por defecto cae debajo del
      // lienzo: se acota para que la mesa nueva siempre aparezca a la vista.
      const nueva = nuevaMesaEnEdicion(clientId, numero, prev.length);
      return [
        ...prev,
        { ...nueva, ...limitarCentro(nueva, semiExtension(nueva), lienzo) },
      ];
    });
    setSeleccionada(clientId);
  }

  function handleCambiarForma(forma: FormaMesa) {
    if (!mesaSeleccionada) return;
    const cambios = cambiarForma(mesaSeleccionada, forma);
    // Un rectángulo es más ancho que el círculo o cuadrado de origen: si la
    // mesa estaba pegada al borde, se reacomoda para que entre entera.
    const posicion = limitarCentro(
      mesaSeleccionada,
      semiExtension({ ...mesaSeleccionada, ...cambios }),
      lienzo,
    );
    actualizarMesa(mesaSeleccionada.clientId, { ...cambios, ...posicion });
  }

  function handleEliminarSeleccionada() {
    if (!seleccionada) return;
    const resultado = quitarMesa(mesas, eliminadas, seleccionada);
    setMesas(resultado.mesas);
    setEliminadas(resultado.eliminadas);
    setSeleccionada(null);
  }

  const puedeEliminarSeleccionada =
    !!mesaSeleccionada && puedeEliminarMesa(mesaSeleccionada);
  const hayCambiosParaGuardar = mesas.length > 0 || eliminadas.length > 0;

  function handleClickStage(
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) {
    // Clic en el fondo del Stage (no en una mesa) deselecciona — mismo
    // criterio de "target === currentTarget" que ya usa Dialog.tsx para
    // distinguir clic en el fondo de clic en un hijo.
    if (e.target === e.target.getStage()) {
      setSeleccionada(null);
    }
  }

  function confirmarEdicionNumero() {
    if (!editandoNumero) return;
    const nuevoNumero = parsearNumeroMesa(editandoNumero.valor);
    if (nuevoNumero !== null) {
      actualizarMesa(editandoNumero.clientId, { numero: nuevoNumero });
    }
    setEditandoNumero(null);
  }

  // --- Guardado: POST /mesas/layout ---------------------------------------------
  async function handleGuardar() {
    if (!token || duplicados.length > 0 || !hayCambiosParaGuardar) return;
    setGuardando(true);
    setGuardadoError(null);
    setGuardadoOk(false);
    try {
      const payload: GuardarLayoutPayload = {
        restauranteId,
        mesas: aGuardarLayoutItems(mesas),
        ...(eliminadas.length > 0
          ? { eliminar: idsAEliminar(eliminadas) }
          : {}),
      };
      await apiFetch("/mesas/layout", token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setGuardadoOk(true);
      setEliminadas([]);
      // Trae los id reales que Prisma asignó a las mesas nuevas — sin esto,
      // un segundo guardado las volvería a crear en vez de actualizarlas
      // (guardarLayout crea cuando el item no trae `id`).
      await cargarLayout();
    } catch (err) {
      const mensaje =
        err instanceof ApiError ? err.message : "No se pudo guardar el mapa";
      // El guardado es una sola transacción: si falló, no se borró ninguna
      // mesa. Se devuelven al mapa para que lo que se ve coincida con la base
      // (el resto de los cambios sigue en pantalla, sin guardar).
      if (eliminadas.length > 0) {
        setMesas((prev) => [...prev, ...eliminadas]);
        setEliminadas([]);
        setGuardadoError(
          `${mensaje} Las mesas eliminadas se volvieron a agregar al mapa.`,
        );
      } else {
        setGuardadoError(mensaje);
      }
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
      <div
        role="alert"
        className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
      >
        {loadError}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!puedeEditar && (
        <output className="block rounded-lg bg-surface-container-low px-4 py-2 text-label-md text-on-surface-variant">
          Estás viendo el mapa en modo solo lectura. Solo un Administrador puede
          editarlo.
        </output>
      )}

      {puedeEditar && reubicadas > 0 && (
        <output className="block rounded-lg bg-surface-container-low px-4 py-2 text-label-md text-on-surface-variant">
          {reubicadas === 1
            ? "Se reubicó 1 mesa que estaba fuera del área visible."
            : `Se reubicaron ${reubicadas} mesas que estaban fuera del área visible.`}{" "}
          Guardá el mapa para conservar la nueva posición.
        </output>
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
              <span>Agregar mesa</span>
            </button>
            <button
              type="button"
              onClick={handleEliminarSeleccionada}
              disabled={!puedeEliminarSeleccionada}
              title={
                mesaSeleccionada && !puedeEliminarSeleccionada
                  ? "Solo se pueden eliminar mesas libres"
                  : undefined
              }
              className="flex items-center gap-2 rounded-lg border border-outline-variant px-4 py-2 text-body-md text-on-surface-variant hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[20px]">
                delete
              </span>
              <span>Eliminar mesa</span>
            </button>
            <fieldset
              disabled={!mesaSeleccionada}
              className="flex items-center gap-1 rounded-lg border border-outline-variant p-1 disabled:opacity-50"
            >
              <legend className="sr-only">Forma de la mesa seleccionada</legend>
              {OPCIONES_FORMA.map(({ forma, etiqueta, icono }) => (
                <button
                  key={forma}
                  type="button"
                  onClick={() => handleCambiarForma(forma)}
                  aria-pressed={formaSeleccionada === forma}
                  title={etiqueta}
                  className="flex items-center gap-1 rounded-md px-3 py-1.5 text-body-sm text-on-surface-variant hover:bg-surface-container-low disabled:cursor-not-allowed aria-pressed:bg-primary aria-pressed:text-on-primary"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {icono}
                  </span>
                  <span>{etiqueta}</span>
                </button>
              ))}
            </fieldset>
            <p className="text-label-sm text-on-surface-variant">
              Seleccioná una mesa para cambiar su forma. Doble clic para editar
              su número.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {duplicados.length > 0 && (
              <p role="alert" className="text-label-md text-error">
                Números repetidos: {duplicados.join(", ")}
              </p>
            )}
            {guardadoError && (
              <p role="alert" className="text-label-md text-error">
                {guardadoError}
              </p>
            )}
            {guardadoOk && (
              <p className="text-label-md text-primary">Guardado ✓</p>
            )}
            <button
              type="button"
              onClick={handleGuardar}
              disabled={
                guardando || duplicados.length > 0 || !hayCambiosParaGuardar
              }
              className="rounded-lg bg-primary px-4 py-2 text-body-md font-medium text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar mapa"}
            </button>
          </div>
        </div>
      )}

      <div
        ref={contenedorRef}
        className="relative w-full overflow-x-auto overflow-y-hidden rounded-xl border border-outline-variant bg-surface-container-lowest"
      >
        <Stage
          width={lienzo.ancho}
          height={lienzo.alto}
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
                lienzo={lienzo}
                onSeleccionar={() => setSeleccionada(mesa.clientId)}
                onArrastrar={(x, y) => actualizarMesa(mesa.clientId, { x, y })}
                onTransformar={(cambios) => {
                  // Agrandar o rotar una mesa junto al borde puede dejar una
                  // parte afuera: se reacomoda el centro para que entre entera.
                  const rotacion = normalizarRotacion(cambios.rotacion);
                  const posicion = limitarCentro(
                    cambios,
                    semiExtension({
                      forma: mesa.forma,
                      ancho: cambios.ancho,
                      alto: cambios.alto,
                      rotacion,
                    }),
                    lienzo,
                  );
                  actualizarMesa(mesa.clientId, {
                    ...cambios,
                    ...posicion,
                    rotacion,
                  });
                }}
                onEditarNumero={() => {
                  setSeleccionada(mesa.clientId);
                  setEditandoNumero({
                    clientId: mesa.clientId,
                    valor: String(mesa.numero),
                  });
                }}
              />
            ))}
            {puedeEditar && (
              <Transformer
                ref={transformerRef}
                rotateEnabled
                keepRatio={mantieneProporcion}
                enabledAnchors={
                  mantieneProporcion
                    ? ["top-left", "top-right", "bottom-left", "bottom-right"]
                    : undefined
                }
                // Entre el mínimo del editor y el máximo que acepta el backend
                // (BL-58), para que un resize nunca termine en un 400 al guardar.
                boundBoxFunc={(oldBox, newBox) =>
                  newBox.width < DIMENSION_MINIMA_MESA ||
                  newBox.height < DIMENSION_MINIMA_MESA ||
                  newBox.width > DIMENSION_MAXIMA_MESA ||
                  newBox.height > DIMENSION_MAXIMA_MESA
                    ? oldBox
                    : newBox
                }
              />
            )}
          </Layer>
        </Stage>

        {editandoNumero && posicionInputNumero && (
          <input
            ref={inputNumeroRef}
            type="number"
            min={1}
            value={editandoNumero.valor}
            onChange={(e) =>
              setEditandoNumero({ ...editandoNumero, valor: e.target.value })
            }
            onBlur={confirmarEdicionNumero}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmarEdicionNumero();
              if (e.key === "Escape") setEditandoNumero(null);
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
