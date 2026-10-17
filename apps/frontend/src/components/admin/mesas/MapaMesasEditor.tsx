"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layer, Stage, Transformer } from "react-konva";
import Konva from "konva";
import { io, type Socket } from "socket.io-client";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import { LeyendaEstadosMesa } from "./LeyendaEstadosMesa";
import { ElementoShape } from "./ElementoShape";
import { ListaPlano } from "./ListaPlano";
import { MesaShape } from "./MesaShape";
import { ICONO_POR_ELEMENTO } from "./plano-iconos";
import { ZonaShape } from "./ZonaShape";
import { ControlesZoom } from "./ControlesZoom";
import { usePunteroGrueso } from "./usePunteroGrueso";
import {
  accionDeAtajo,
  accionDeTecla,
  acotarRecuadroZona,
  anchoNecesarioElementos,
  anchoNecesarioZonas,
  aPlanoPayload,
  errorEtiquetaZona,
  esCampoDeTexto,
  fotoParaGuardar,
  girarElemento90,
  LARGO_MAXIMO_ETIQUETA_ZONA,
  MAXIMO_ELEMENTOS_PLANO,
  MAXIMO_ZONAS_PLANO,
  normalizarPlano,
  nuevaZona,
  nuevoElemento,
  puedeAgregarElemento,
  puedeAgregarZona,
  semiExtensionElemento,
  semiExtensionZona,
  tamanoElementoPermitido,
} from "./plano.utils";
import {
  aGuardarLayoutItems,
  anchoNecesarioLienzo,
  aplicarEstadoMesa,
  cambiarForma,
  configuracionTactil,
  desfaseInputNumero,
  textoEditarNumero,
  propsAnclasTransformer,
  CONSULTA_CELULAR,
  distanciaEntrePuntos,
  idsAEliminar,
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
  scrollParaCentrar,
  semiExtension,
  siguienteNumeroDisponible,
  siguienteZoom,
  tamanoMesaPermitido,
  ZOOM_INICIAL,
  type Lienzo,
  zoomParaAjustarAncho,
  zoomPorPellizco,
  type MesaEnEdicion,
} from "./mapa-mesas.utils";
import type {
  FormaMesa,
  GuardarLayoutPayload,
  MesaConLayout,
  MesaEstadoActualizadoPayload,
} from "@/types/mesa";
import {
  TIPOS_ELEMENTO_PLANO,
  type ElementoPlano,
  type TipoElementoPlano,
  type ZonaPlano,
} from "@/types/plano";

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Zoom con dos dedos: Konva sigue escuchando toques mientras se arrastra una
// mesa, así el segundo dedo se detecta aunque el primero haya empezado un
// arrastre. Es seguro porque este módulo se carga solo en el navegador
// (la página lo importa con ssr: false).
Konva.hitOnDragEnabled = true;
const ALTURA_STAGE = 600;

const OPCIONES_FORMA: { forma: FormaMesa; etiqueta: string; icono: string }[] =
  [
    { forma: "CIRCULO", etiqueta: "Círculo", icono: "circle" },
    { forma: "CUADRADO", etiqueta: "Cuadrado", icono: "square" },
    { forma: "RECTANGULO", etiqueta: "Rectángulo", icono: "rectangle" },
  ];

// Raíz del editor. En pantalla completa el navegador pinta de negro lo que
// el elemento no cubra, y se pierden los márgenes de la página: se agregan.
function clasesEditor(pantallaCompleta: boolean): string {
  return pantallaCompleta
    ? "space-y-4 overflow-y-auto bg-surface p-4 md:p-6"
    : "space-y-4";
}

// Recuadro del mapa. touch-pan-x/y: con un dedo se desplaza, pero el
// pellizco lo maneja el mapa y no agranda la página (fuera del mapa el zoom
// del navegador sigue funcionando, WCAG 1.4.4). Alto: hasta 640 px pero
// nunca más del 70 % de la pantalla visible; en pantalla completa usa casi
// todo el alto (14rem para las barras).
function clasesRecuadroMapa(pantallaCompleta: boolean): string {
  const alto = pantallaCompleta
    ? "max-h-[calc(100dvh-14rem)]"
    : "max-h-[min(640px,70dvh)]";
  return `relative block w-full touch-pan-x touch-pan-y overflow-auto rounded-xl border border-outline-variant bg-surface-container-lowest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${alto}`;
}

const ESTILO_BOTON_PROPIEDADES =
  "flex items-center gap-2 rounded-lg border border-outline-variant px-4 py-1.5 text-body-md text-on-surface-variant hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50 touch:min-h-12 touch:px-5";

interface Props {
  restauranteId: string;
  /** HU-034 (BL-204): avisa a la página para recargar los QR de las mesas. */
  onGuardado?: () => void;
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
export function MapaMesasEditor({
  restauranteId,
  onGuardado,
}: Readonly<Props>) {
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
  // HU-028 (BL-173): zonas del salón y la zona seleccionada. Una sola cosa
  // seleccionada a la vez: elegir una zona deselecciona la mesa y al revés.
  const [zonas, setZonas] = useState<ZonaPlano[]>([]);
  const [zonaSeleccionada, setZonaSeleccionada] = useState<string | null>(null);
  // Lo que se está escribiendo en "Nombre de la zona". Solo se pasa a la
  // zona cuando es válido; si no, se muestra el error y la zona conserva el
  // último nombre válido.
  const [etiquetaEnEdicion, setEtiquetaEnEdicion] = useState("");
  // HU-028 (BL-173): elementos fijos (puerta, baño, cocina, caja, barra).
  const [elementos, setElementos] = useState<ElementoPlano[]>([]);
  const [elementoSeleccionado, setElementoSeleccionado] = useState<
    string | null
  >(null);
  // HU-028 (BL-173): foto de lo guardado (mesas y plano), para saber si hay
  // cambios sin guardar. Se toma al cargar y después de cada guardado.
  const [fotoGuardada, setFotoGuardada] = useState<string | null>(null);
  // BL-58: mesas ya guardadas que el administrador quitó del mapa y que se
  // borran en el próximo guardado. Se guarda la mesa completa (no solo el
  // id) para poder devolverla al mapa si el guardado falla.
  const [eliminadas, setEliminadas] = useState<MesaEnEdicion[]>([]);
  const [editandoNumero, setEditandoNumero] = useState<{
    clientId: string;
    valor: string;
  } | null>(null);

  const contenedorRef = useRef<HTMLDivElement>(null);
  // Raíz del editor: los atajos de teclado se escuchan acá, solo con el
  // foco dentro del editor (WCAG 2.1.4).
  const editorRef = useRef<HTMLDivElement>(null);
  // Modo pantalla completa del editor (tablet fija del salón o de la caja).
  // Safari de iPhone no lo soporta: ahí el botón no se muestra.
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  const [admitePantallaCompleta, setAdmitePantallaCompleta] = useState(false);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef(new Map<string, Konva.Group>());
  const transformerZonaRef = useRef<Konva.Transformer>(null);
  const zonaRefs = useRef(new Map<string, Konva.Group>());
  const transformerElementoRef = useRef<Konva.Transformer>(null);
  const elementoRefs = useRef(new Map<string, Konva.Group>());
  const socketRef = useRef<Socket | null>(null);
  const inputNumeroRef = useRef<HTMLInputElement>(null);
  const [anchoStage, setAnchoStage] = useState(800);
  // true cuando el ResizeObserver ya midió el recuadro: antes de eso
  // anchoStage vale 800 por defecto y no sirve para ajustar el zoom.
  const [anchoMedido, setAnchoMedido] = useState(false);
  const zoomAjustadoRef = useRef(false);
  // HU-028 (BL-173): zoom del mapa. Lo pueden usar ADMIN y MOZO; no se
  // guarda (cada vez que se abre el mapa arranca en 100%).
  const [zoom, setZoom] = useState<number>(ZOOM_INICIAL);
  // Tablet o celular: anclas del Transformer y zonas de toque más grandes
  // (Konva no ve las clases touch: de Tailwind, por eso va por props).
  const tactil = usePunteroGrueso();
  const tactilConfig = configuracionTactil(tactil);
  const propsAnclas = propsAnclasTransformer(tactilConfig);

  // --- Carga inicial: GET /mesas/layout y GET /mesas/plano -------------------
  // Se piden juntas. HU-028 (BL-173): el plano (zonas y elementos fijos) lo
  // pueden leer ADMIN y MOZO, igual que el layout de las mesas.
  const cargarLayout = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [data, datosPlano] = await Promise.all([
        apiFetch<MesaConLayout[]>(
          `/mesas/layout?restauranteId=${restauranteId}`,
          token,
        ),
        apiFetch<unknown>(`/mesas/plano?restauranteId=${restauranteId}`, token),
      ]);
      const comoEstan = mesasConLayoutAEdicion(data);
      const cargadas = reubicarFueraDelLienzo(comoEstan, ALTURA_STAGE);
      setMesas(cargadas.mesas);
      setReubicadas(cargadas.reubicadas);
      const plano = normalizarPlano(datosPlano);
      setZonas(plano.zonas);
      setElementos(plano.elementos);
      // La foto se toma con las mesas como están en la base (antes de
      // reubicar): si se reubicó alguna, cuenta como cambio sin guardar.
      setFotoGuardada(
        fotoParaGuardar(
          aGuardarLayoutItems(comoEstan),
          plano.zonas,
          plano.elementos,
        ),
      );
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
      if (ancho) {
        setAnchoStage(Math.floor(ancho));
        setAnchoMedido(true);
      }
    });
    observer.observe(contenedor);
    return () => observer.disconnect();
  }, [loading]);

  // El lienzo es al menos tan ancho como el contenedor, y se ensancha si
  // alguna mesa quedó más a la derecha (salón guardado en una pantalla más
  // ancha): en ese caso aparece scroll horizontal en vez de esconderla.
  const lienzo: Lienzo = useMemo(
    () => ({
      ancho: Math.max(
        anchoStage,
        anchoNecesarioLienzo(mesas),
        anchoNecesarioZonas(zonas),
        anchoNecesarioElementos(elementos),
      ),
      alto: ALTURA_STAGE,
    }),
    [anchoStage, mesas, zonas, elementos],
  );

  // Celular: la primera vez que se mide el recuadro, el mapa arranca
  // ajustado al ancho para ver el salón entero. Después respeta el zoom que
  // elija el usuario (no se vuelve a ajustar al rotar la pantalla).
  useEffect(() => {
    if (!anchoMedido || zoomAjustadoRef.current) return;
    zoomAjustadoRef.current = true;
    if (window.matchMedia(CONSULTA_CELULAR).matches) {
      setZoom(zoomParaAjustarAncho(anchoStage, lienzo.ancho));
    }
  }, [anchoMedido, anchoStage, lienzo.ancho]);

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

  // HU-028 (BL-173): mismo mecanismo para la zona seleccionada, con su
  // propio Transformer (las zonas no rotan y tienen otros límites de tamaño).
  useEffect(() => {
    const tr = transformerZonaRef.current;
    if (!tr) return;
    const nodo = zonaSeleccionada
      ? zonaRefs.current.get(zonaSeleccionada)
      : undefined;
    tr.nodes(nodo && puedeEditar ? [nodo] : []);
    tr.forceUpdate();
    tr.getLayer()?.batchDraw();
  }, [zonaSeleccionada, puedeEditar, zonas]);

  // Y para el elemento fijo seleccionado (tercer Transformer: rota, con
  // tamaños propios).
  useEffect(() => {
    const tr = transformerElementoRef.current;
    if (!tr) return;
    const nodo = elementoSeleccionado
      ? elementoRefs.current.get(elementoSeleccionado)
      : undefined;
    tr.nodes(nodo && puedeEditar ? [nodo] : []);
    tr.forceUpdate();
    tr.getLayer()?.batchDraw();
  }, [elementoSeleccionado, puedeEditar, elementos]);

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

  const zonaActual = zonas.find((z) => z.id === zonaSeleccionada);
  const errorEtiqueta = zonaActual
    ? errorEtiquetaZona(etiquetaEnEdicion)
    : null;
  const elementoActual = elementos.find((e) => e.id === elementoSeleccionado);

  // --- Selección ------------------------------------------------------------------
  // Una sola cosa seleccionada a la vez: mesa, zona o elemento fijo.
  function seleccionarMesa(clientId: string) {
    setSeleccionada(clientId);
    setZonaSeleccionada(null);
    setElementoSeleccionado(null);
  }

  function seleccionarZona(zona: ZonaPlano) {
    setZonaSeleccionada(zona.id);
    setEtiquetaEnEdicion(zona.etiqueta);
    setSeleccionada(null);
    setElementoSeleccionado(null);
  }

  function seleccionarElemento(id: string) {
    setElementoSeleccionado(id);
    setSeleccionada(null);
    setZonaSeleccionada(null);
  }

  useEffect(() => {
    setAdmitePantallaCompleta(document.fullscreenEnabled === true);
    const alCambiar = () =>
      setPantallaCompleta(
        document.fullscreenElement !== null &&
          document.fullscreenElement === editorRef.current,
      );
    document.addEventListener("fullscreenchange", alCambiar);
    return () => document.removeEventListener("fullscreenchange", alCambiar);
  }, []);

  async function alternarPantallaCompleta() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await editorRef.current?.requestFullscreen();
    } catch {
      // El navegador lo rechazó (permiso o política): se sigue en modo normal.
    }
  }

  // Lleva el foco al recuadro del mapa, para que las flechas muevan lo
  // seleccionado. preventScroll: el foco no tiene que desplazar la página.
  // Con el dedo no hace falta (no hay teclado físico) y el anillo de foco
  // solo molestaría.
  function enfocarMapa() {
    if (tactil) return;
    contenedorRef.current?.focus({ preventScroll: true });
  }

  // Desde la lista del plano: selecciona la mesa y la centra en el mapa,
  // para encontrarla sin buscarla a ojo (sobre todo en el celular, donde la
  // lista es la vista principal).
  function verMesaEnMapa(clientId: string) {
    seleccionarMesa(clientId);
    const mesa = mesas.find((m) => m.clientId === clientId);
    const contenedor = contenedorRef.current;
    if (!mesa || !contenedor) return;
    const sinAnimacion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const comportamiento: ScrollBehavior = sinAnimacion ? "auto" : "smooth";
    contenedor.scrollTo({
      ...scrollParaCentrar(mesa, zoom, {
        ancho: contenedor.clientWidth,
        alto: contenedor.clientHeight,
      }),
      behavior: comportamiento,
    });
    contenedor.scrollIntoView({ behavior: comportamiento, block: "nearest" });
    enfocarMapa();
  }

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
    seleccionarMesa(clientId);
  }

  // --- Zonas (HU-028) -------------------------------------------------------------
  function actualizarZona(id: string, cambios: Partial<ZonaPlano>) {
    setZonas((prev) =>
      prev.map((z) => (z.id === id ? { ...z, ...cambios } : z)),
    );
  }

  function handleAgregarZona() {
    if (!puedeAgregarZona(zonas)) return;
    const zona = nuevaZona(crypto.randomUUID(), zonas, lienzo);
    setZonas((prev) => [...prev, zona]);
    seleccionarZona(zona);
  }

  function handleEliminarZona() {
    if (!zonaSeleccionada) return;
    setZonas((prev) => prev.filter((z) => z.id !== zonaSeleccionada));
    setZonaSeleccionada(null);
  }

  function handleCambiarEtiqueta(valor: string) {
    setEtiquetaEnEdicion(valor);
    if (zonaSeleccionada && errorEtiquetaZona(valor) === null) {
      actualizarZona(zonaSeleccionada, { etiqueta: valor.trim() });
    }
  }

  // --- Elementos fijos (HU-028) ------------------------------------------------
  function actualizarElemento(id: string, cambios: Partial<ElementoPlano>) {
    setElementos((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...cambios } : e)),
    );
  }

  function handleAgregarElemento(tipo: TipoElementoPlano) {
    if (!puedeAgregarElemento(elementos)) return;
    const elemento = nuevoElemento(
      crypto.randomUUID(),
      tipo,
      elementos,
      lienzo,
    );
    setElementos((prev) => [...prev, elemento]);
    seleccionarElemento(elemento.id);
  }

  function handleGirarElemento() {
    if (!elementoActual) return;
    actualizarElemento(
      elementoActual.id,
      girarElemento90(elementoActual, lienzo),
    );
  }

  function handleEliminarElemento() {
    if (!elementoSeleccionado) return;
    setElementos((prev) => prev.filter((e) => e.id !== elementoSeleccionado));
    setElementoSeleccionado(null);
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
  // HU-028 (BL-173): hay cambios sin guardar si lo que se mandaría difiere
  // de la última foto guardada, o si hay mesas quitadas pendientes.
  const hayCambiosSinGuardar = useMemo(
    () =>
      eliminadas.length > 0 ||
      (fotoGuardada !== null &&
        fotoParaGuardar(aGuardarLayoutItems(mesas), zonas, elementos) !==
          fotoGuardada),
    [eliminadas, fotoGuardada, mesas, zonas, elementos],
  );

  // Aviso del navegador al cerrar o recargar la pestaña con cambios sin
  // guardar. No cubre la navegación interna de Next (links del menú).
  useEffect(() => {
    if (!puedeEditar || !hayCambiosSinGuardar) return;
    // preventDefault() alcanza en los navegadores actuales; returnValue
    // está obsoleto y no hace falta.
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [puedeEditar, hayCambiosSinGuardar]);

  // Atajos de teclado: Supr / Borrar elimina lo seleccionado, Esc
  // deselecciona. El handler se guarda en una ref para que el listener
  // (que se registra una sola vez) use siempre el estado actual.
  const manejarTeclaRef = useRef<(e: KeyboardEvent) => void>(() => {});
  manejarTeclaRef.current = (e: KeyboardEvent) => {
    if (editandoNumero) return;
    const accion = accionDeTecla(
      e.key,
      esCampoDeTexto(e.target as HTMLElement | null),
    );
    if (accion === "deseleccionar") {
      setSeleccionada(null);
      setZonaSeleccionada(null);
      setElementoSeleccionado(null);
    } else if (accion === "eliminar") {
      if (mesaSeleccionada && puedeEliminarSeleccionada) {
        e.preventDefault();
        handleEliminarSeleccionada();
      } else if (zonaActual) {
        e.preventDefault();
        handleEliminarZona();
      } else if (elementoActual) {
        e.preventDefault();
        handleEliminarElemento();
      }
    }
  };
  useEffect(() => {
    if (!puedeEditar) return;
    const escuchar = (e: KeyboardEvent) => manejarTeclaRef.current(e);
    window.addEventListener("keydown", escuchar);
    return () => window.removeEventListener("keydown", escuchar);
  }, [puedeEditar]);

  // Mueve lo seleccionado con el teclado, sin salir del lienzo (mismo límite
  // que al arrastrar).
  function moverSeleccion(dx: number, dy: number) {
    if (mesaSeleccionada) {
      const movida = {
        ...mesaSeleccionada,
        x: mesaSeleccionada.x + dx,
        y: mesaSeleccionada.y + dy,
      };
      actualizarMesa(
        mesaSeleccionada.clientId,
        limitarCentro(movida, semiExtension(movida), lienzo),
      );
    } else if (zonaActual) {
      const movida = { ...zonaActual, x: zonaActual.x + dx, y: zonaActual.y + dy };
      actualizarZona(
        zonaActual.id,
        limitarCentro(movida, semiExtensionZona(movida), lienzo),
      );
    } else if (elementoActual) {
      const movido = {
        ...elementoActual,
        x: elementoActual.x + dx,
        y: elementoActual.y + dy,
      };
      actualizarElemento(
        elementoActual.id,
        limitarCentro(movido, semiExtensionElemento(movido), lienzo),
      );
    }
  }

  // Atajos de zoom, mover y guardar. Mismo patrón de ref que el de Supr /
  // Esc, pero escuchando en la raíz del editor en vez de en window: así
  // los atajos de una sola tecla solo actúan con el foco dentro del editor.
  const manejarAtajoRef = useRef<(e: KeyboardEvent) => void>(() => {});
  manejarAtajoRef.current = (e: KeyboardEvent) => {
    if (editandoNumero) return;
    const haySeleccion = !!(mesaSeleccionada || zonaActual || elementoActual);
    const atajo = accionDeAtajo(
      e,
      esCampoDeTexto(e.target as HTMLElement | null),
      puedeEditar && haySeleccion,
    );
    if (!atajo) return;
    if (atajo.tipo === "guardar" && !puedeEditar) return;
    // Evita el scroll con las flechas y el «Guardar página» del navegador.
    e.preventDefault();
    if (atajo.tipo === "acercar") setZoom((z) => siguienteZoom(z, 1));
    else if (atajo.tipo === "alejar") setZoom((z) => siguienteZoom(z, -1));
    else if (atajo.tipo === "zoom-inicial") setZoom(ZOOM_INICIAL);
    else if (atajo.tipo === "guardar") {
      if (guardando) return;
      // Al guardar se recarga el mapa (spinner) y el foco se pierde: se
      // marca para devolverlo al mapa cuando termine de cargar.
      reenfocarTrasCargarRef.current = true;
      void handleGuardar();
    } else moverSeleccion(atajo.dx, atajo.dy);
  };
  const reenfocarTrasCargarRef = useRef(false);
  useEffect(() => {
    if (loading || !reenfocarTrasCargarRef.current) return;
    reenfocarTrasCargarRef.current = false;
    contenedorRef.current?.focus({ preventScroll: true });
  }, [loading]);
  useEffect(() => {
    // Mientras carga se muestra el spinner y la raíz todavía no existe.
    const editor = editorRef.current;
    if (!editor) return;
    const escuchar = (e: KeyboardEvent) => manejarAtajoRef.current(e);
    editor.addEventListener("keydown", escuchar);
    return () => editor.removeEventListener("keydown", escuchar);
  }, [loading, loadError]);

  function handleClickStage(
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) {
    // Clic en el fondo del Stage (no en una mesa) deselecciona — mismo
    // criterio de "target === currentTarget" que ya usa Dialog.tsx para
    // distinguir clic en el fondo de clic en un hijo.
    if (e.target === e.target.getStage()) {
      setSeleccionada(null);
      setZonaSeleccionada(null);
      setElementoSeleccionado(null);
    }
  }

  // --- Zoom con dos dedos (móvil y tablet) -------------------------------------
  // Se guarda la distancia entre los dedos y el zoom con los que arrancó el
  // gesto, y se escala desde ahí. Con un dedo no se hace nada: sigue el
  // arrastre de mesas (ADMIN) o el scroll del recuadro.
  const pellizcoRef = useRef<{ distancia: number; zoom: number } | null>(
    null,
  );

  function handleTouchMove(e: Konva.KonvaEventObject<TouchEvent>) {
    const toques = e.evt.touches;
    if (toques.length !== 2) return;
    e.evt.preventDefault();
    // Si el primer dedo había empezado a arrastrar una mesa, se suelta.
    if (e.target.isDragging()) e.target.stopDrag();
    const distancia = distanciaEntrePuntos(toques[0], toques[1]);
    if (!pellizcoRef.current) {
      pellizcoRef.current = { distancia, zoom };
      return;
    }
    setZoom(
      zoomPorPellizco(
        pellizcoRef.current.zoom,
        pellizcoRef.current.distancia,
        distancia,
      ),
    );
  }

  function handleTouchEnd(e: Konva.KonvaEventObject<TouchEvent>) {
    if (e.evt.touches.length < 2) pellizcoRef.current = null;
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
    if (!token || duplicados.length > 0 || !hayCambiosSinGuardar) return;
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
        // HU-028 (BL-173): el plano completo, en la misma transacción.
        plano: aPlanoPayload(zonas, elementos),
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
      onGuardado?.();
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
    <div
      ref={editorRef}
      // En pantalla completa el navegador pinta de negro lo que el elemento
      // no cubra, y se pierden los márgenes de la página: se agregan acá.
      className={clasesEditor(pantallaCompleta)}
    >
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
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-body-md font-medium text-on-primary hover:opacity-90 touch:min-h-12"
            >
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[20px]"
              >
                add
              </span>
              <span>Agregar mesa</span>
            </button>
            <button
              type="button"
              onClick={handleAgregarZona}
              disabled={!puedeAgregarZona(zonas)}
              title={
                puedeAgregarZona(zonas)
                  ? undefined
                  : `Se pueden agregar hasta ${MAXIMO_ZONAS_PLANO} zonas`
              }
              className="flex items-center gap-2 rounded-lg border border-outline-variant px-4 py-2 text-body-md text-on-surface-variant hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50 touch:min-h-12"
            >
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[20px]"
              >
                crop_free
              </span>
              <span>Agregar zona</span>
            </button>
            <fieldset
              disabled={!puedeAgregarElemento(elementos)}
              title={
                puedeAgregarElemento(elementos)
                  ? undefined
                  : `Se pueden agregar hasta ${MAXIMO_ELEMENTOS_PLANO} elementos`
              }
              className="flex flex-wrap items-center gap-1 rounded-lg border border-outline-variant p-1 disabled:opacity-50 touch:gap-2"
            >
              <legend className="sr-only">Agregar elemento fijo</legend>
              {TIPOS_ELEMENTO_PLANO.map((tipo) => (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => handleAgregarElemento(tipo)}
                  title={`Agregar ${ICONO_POR_ELEMENTO[tipo].etiqueta.toLowerCase()}`}
                  className="flex items-center gap-1 rounded-md px-3 py-1.5 text-body-sm text-on-surface-variant hover:bg-surface-container-low disabled:cursor-not-allowed touch:min-h-12 touch:min-w-12 touch:px-4"
                >
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[18px]"
                  >
                    {ICONO_POR_ELEMENTO[tipo].icono}
                  </span>
                  <span>{ICONO_POR_ELEMENTO[tipo].etiqueta}</span>
                </button>
              ))}
            </fieldset>
          </div>

          <div className="flex flex-wrap items-center gap-3">
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
            {/* Siempre presente: un lector de pantalla solo anuncia los
                cambios de una región "status" que ya existía (WCAG 4.1.3).
                <output> ya tiene ese rol de forma nativa. */}
            <output className="text-label-md text-primary">
              {guardadoOk ? "Guardado ✓" : ""}
            </output>
            {hayCambiosSinGuardar && !guardando && (
              <p className="flex items-center gap-1 text-label-md text-on-surface-variant">
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined text-[18px]"
                >
                  edit_note
                </span>
                <span>Cambios sin guardar</span>
              </p>
            )}
            <button
              type="button"
              onClick={handleGuardar}
              disabled={
                guardando || duplicados.length > 0 || !hayCambiosSinGuardar
              }
              className="rounded-lg bg-primary px-4 py-2 text-body-md font-medium text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 touch:min-h-12"
            >
              {guardando ? "Guardando…" : "Guardar mapa"}
            </button>
          </div>
        </div>
      )}

      {/* HU-028 (BL-173): barra de propiedades. Muestra las acciones de lo
          seleccionado (mesa, zona o elemento). Todo va en una sola línea y la
          barra tiene la altura de esa línea (min-h): así se ajusta al
          contenido y el mapa no salta al cambiar de selección. */}
      {puedeEditar && (
        <section
          aria-label="Propiedades de la selección"
          className="flex min-h-[3.75rem] flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-surface-container-low px-4 py-2"
        >
          {mesaSeleccionada && (
            <>
              <p className="text-label-md text-on-surface">
                Mesa {mesaSeleccionada.numero}
              </p>
              <fieldset className="flex items-center gap-1 rounded-lg border border-outline-variant p-1 touch:gap-2">
                <legend className="sr-only">Forma de la mesa</legend>
                {OPCIONES_FORMA.map(({ forma, etiqueta, icono }) => (
                  <button
                    key={forma}
                    type="button"
                    onClick={() => handleCambiarForma(forma)}
                    aria-pressed={formaSeleccionada === forma}
                    title={etiqueta}
                    className="flex items-center gap-1 rounded-md px-3 py-1.5 text-body-sm text-on-surface-variant hover:bg-surface-container aria-pressed:bg-primary aria-pressed:text-on-primary touch:min-h-12 touch:min-w-12 touch:px-4"
                  >
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-[18px]"
                    >
                      {icono}
                    </span>
                    <span>{etiqueta}</span>
                  </button>
                ))}
              </fieldset>
              <button
                type="button"
                onClick={handleEliminarSeleccionada}
                disabled={!puedeEliminarSeleccionada}
                title={
                  puedeEliminarSeleccionada
                    ? undefined
                    : "Solo se pueden eliminar mesas libres"
                }
                className={ESTILO_BOTON_PROPIEDADES}
              >
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined text-[20px]"
                >
                  delete
                </span>
                <span>Eliminar mesa</span>
              </button>
              <p className="text-label-sm text-on-surface-variant">
                {textoEditarNumero(tactil)}
              </p>
            </>
          )}

          {zonaActual && (
            <>
              <label
                htmlFor="etiqueta-zona"
                className="text-label-md text-on-surface"
              >
                Nombre de la zona
              </label>
              <input
                id="etiqueta-zona"
                type="text"
                value={etiquetaEnEdicion}
                maxLength={LARGO_MAXIMO_ETIQUETA_ZONA}
                onChange={(e) => handleCambiarEtiqueta(e.target.value)}
                aria-invalid={errorEtiqueta !== null}
                aria-describedby={
                  errorEtiqueta ? "etiqueta-zona-error" : undefined
                }
                className="w-full rounded-lg border border-outline-variant bg-surface px-3 py-1.5 text-body-md text-on-surface aria-[invalid=true]:border-error sm:w-64 touch:min-h-12"
              />
              <button
                type="button"
                onClick={handleEliminarZona}
                className={ESTILO_BOTON_PROPIEDADES}
              >
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined text-[20px]"
                >
                  delete
                </span>
                <span>Eliminar zona</span>
              </button>
              {errorEtiqueta && (
                <p
                  id="etiqueta-zona-error"
                  role="alert"
                  className="text-label-sm text-error"
                >
                  {errorEtiqueta}
                </p>
              )}
            </>
          )}

          {elementoActual && (
            <>
              <p className="flex items-center gap-2 text-label-md text-on-surface">
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined text-[20px]"
                >
                  {ICONO_POR_ELEMENTO[elementoActual.tipo].icono}
                </span>
                <span>{ICONO_POR_ELEMENTO[elementoActual.tipo].etiqueta}</span>
              </p>
              <button
                type="button"
                onClick={handleGirarElemento}
                className={ESTILO_BOTON_PROPIEDADES}
              >
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined text-[20px]"
                >
                  rotate_90_degrees_cw
                </span>
                <span>Girar 90°</span>
              </button>
              <button
                type="button"
                onClick={handleEliminarElemento}
                className={ESTILO_BOTON_PROPIEDADES}
              >
                <span
                  aria-hidden="true"
                  className="material-symbols-outlined text-[20px]"
                >
                  delete
                </span>
                <span>Eliminar elemento</span>
              </button>
            </>
          )}

          {!mesaSeleccionada && !zonaActual && !elementoActual && (
            <p className="text-label-md text-on-surface-variant">
              Seleccioná una mesa, una zona o un elemento para editarlo.
              Arrastrá para moverlo y usá las esquinas para cambiar su tamaño.
              Con el teclado: flechas para moverlo, Supr para eliminarlo y Esc
              para deseleccionarlo.
            </p>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <LeyendaEstadosMesa />
        {/* Ayuda de los atajos. Se esconde en tablets y celulares, donde no
            hay teclado físico. */}
        <details
          id="atajos-plano"
          className="text-label-md text-on-surface-variant touch:hidden"
        >
          <summary className="flex min-h-[44px] cursor-pointer items-center">
            Atajos de teclado
          </summary>
          <ul className="mt-1 space-y-1 text-body-sm">
            <li>
              <kbd>+</kbd> y <kbd>-</kbd> acercan y alejan; <kbd>0</kbd> vuelve
              al 100 %.
            </li>
            {puedeEditar && (
              <>
                <li>
                  Flechas: mueven lo seleccionado (con <kbd>Shift</kbd>, de a
                  10).
                </li>
                <li>
                  <kbd>Supr</kbd> elimina, <kbd>Esc</kbd> deselecciona y{" "}
                  <kbd>Ctrl</kbd> + <kbd>S</kbd> guarda.
                </li>
              </>
            )}
          </ul>
        </details>
        <ControlesZoom
          zoom={zoom}
          onCambiarZoom={setZoom}
          onAjustarAncho={() =>
            setZoom(zoomParaAjustarAncho(anchoStage, lienzo.ancho))
          }
          admitePantallaCompleta={admitePantallaCompleta}
          pantallaCompleta={pantallaCompleta}
          onAlternarPantallaCompleta={() => void alternarPantallaCompleta()}
        />
      </div>

      <section
        ref={contenedorRef}
        // tabIndex -1: el foco llega por código, al elegir una mesa en el
        // mapa o en la lista ("Ver la mesa N en el mapa"), para que las
        // flechas la muevan. No entra en el orden de Tab: un <section> no es
        // un control (Sonar / jsx-a11y no-noninteractive-tabindex).
        tabIndex={-1}
        aria-label="Mapa de mesas"
        aria-describedby="atajos-plano"
        // touch-pan-x/y: con un dedo el recuadro se desplaza, pero el
        // pellizco ya no agranda toda la página, lo maneja el mapa. Fuera
        // del mapa el zoom del navegador sigue funcionando (WCAG 1.4.4).
        // Alto: hasta 640 px pero nunca más del 70 % de la pantalla visible,
        // así en una tablet horizontal entran las barras y el mapa juntos.
        // En pantalla completa usa casi todo el alto (14rem para las barras).
        className={clasesRecuadroMapa(pantallaCompleta)}
      >
        {/* HU-028 (BL-173): el Stage se escala con el zoom (botones o dos
            dedos). Las mesas siguen en unidades del lienzo; si el mapa no
            entra, el contenedor muestra scroll. */}
        <Stage
          width={lienzo.ancho * zoom}
          height={lienzo.alto * zoom}
          scaleX={zoom}
          scaleY={zoom}
          onMouseDown={handleClickStage}
          onTouchStart={handleClickStage}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <Layer>
            {/* HU-028 (BL-173): las zonas van primero para quedar debajo
                de las mesas. */}
            {zonas.map((zona) => (
              <ZonaShape
                key={zona.id}
                ref={(nodo) => {
                  if (nodo) zonaRefs.current.set(zona.id, nodo);
                  else zonaRefs.current.delete(zona.id);
                }}
                zona={zona}
                seleccionada={zona.id === zonaSeleccionada}
                editable={puedeEditar}
                lienzo={lienzo}
                zoom={zoom}
                onSeleccionar={() => {
                  seleccionarZona(zona);
                  enfocarMapa();
                }}
                onCambiar={(cambios) => {
                  // Agrandar una zona junto al borde puede dejar una parte
                  // afuera: se reacomoda el centro para que entre entera.
                  const actualizada = { ...zona, ...cambios };
                  actualizarZona(zona.id, {
                    ...cambios,
                    ...limitarCentro(
                      actualizada,
                      semiExtensionZona(actualizada),
                      lienzo,
                    ),
                  });
                }}
              />
            ))}
            {/* Los elementos fijos van entre las zonas y las mesas. */}
            {elementos.map((elemento) => (
              <ElementoShape
                key={elemento.id}
                ref={(nodo) => {
                  if (nodo) elementoRefs.current.set(elemento.id, nodo);
                  else elementoRefs.current.delete(elemento.id);
                }}
                elemento={elemento}
                seleccionado={elemento.id === elementoSeleccionado}
                editable={puedeEditar}
                lienzo={lienzo}
                zoom={zoom}
                onSeleccionar={() => {
                  seleccionarElemento(elemento.id);
                  enfocarMapa();
                }}
                onCambiar={(cambios) => {
                  // Igual que con las mesas: agrandar o rotar junto al borde
                  // puede dejar una parte afuera, así que se reacomoda.
                  const rotacion = normalizarRotacion(
                    cambios.rotacion ?? elemento.rotacion,
                  );
                  const actualizado = { ...elemento, ...cambios, rotacion };
                  actualizarElemento(elemento.id, {
                    ...cambios,
                    rotacion,
                    ...limitarCentro(
                      actualizado,
                      semiExtensionElemento(actualizado),
                      lienzo,
                    ),
                  });
                }}
              />
            ))}
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
                zoom={zoom}
                zonaToque={tactilConfig.zonaToqueMesa}
                onSeleccionar={() => {
                  seleccionarMesa(mesa.clientId);
                  enfocarMapa();
                }}
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
                  seleccionarMesa(mesa.clientId);
                  setEditandoNumero({
                    clientId: mesa.clientId,
                    valor: String(mesa.numero),
                  });
                }}
              />
            ))}
            {puedeEditar && (
              <Transformer
                {...propsAnclas}
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
                // El recuadro llega en píxeles de pantalla (con zoom).
                boundBoxFunc={(oldBox, newBox) =>
                  tamanoMesaPermitido(newBox, zoom) ? newBox : oldBox
                }
              />
            )}
            {puedeEditar && (
              <Transformer
                {...propsAnclas}
                ref={transformerZonaRef}
                rotateEnabled={false}
                // Ancho y alto independientes: una zona puede ser una franja.
                keepRatio={false}
                // El recuadro llega en píxeles de pantalla (con zoom).
                boundBoxFunc={(oldBox, newBox) =>
                  acotarRecuadroZona(oldBox, newBox, zoom, lienzo)
                }
              />
            )}
            {puedeEditar && (
              <Transformer
                {...propsAnclas}
                ref={transformerElementoRef}
                rotateEnabled
                // Ayuda a dejar puertas y barras derechas: el giro "se pega"
                // a 0°, 90°, 180° y 270° cuando pasa cerca.
                rotationSnaps={[0, 90, 180, 270]}
                keepRatio={false}
                boundBoxFunc={(oldBox, newBox) =>
                  tamanoElementoPermitido(newBox, zoom) ? newBox : oldBox
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
            // Con el dedo el campo crece a 48 px y la letra pasa a 16 px:
            // con menos, Safari de iOS agranda la página al enfocarlo.
            className="absolute z-10 w-14 rounded border border-primary bg-surface px-1 py-0.5 text-center text-body-sm text-on-surface shadow-md outline-none touch:h-12 touch:w-20 touch:text-body-lg"
            style={{
              left: posicionInputNumero.x - desfaseInputNumero(tactil).x,
              top: posicionInputNumero.y - desfaseInputNumero(tactil).y,
            }}
          />
        )}
      </section>

      <ListaPlano
        mesas={mesas}
        zonas={zonas}
        elementos={elementos}
        onVerMesa={verMesaEnMapa}
      />
    </div>
  );
}
