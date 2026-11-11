"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import ItemImagen from "@/components/menu/ItemImagen";
import { rutaPrivacidad } from "@/components/privacidad/privacidad.utils";
import { LlamarMozoButton } from "@/components/LlamarMozoButton";
import { MisPedidosBoton } from "@/components/mis-pedidos/MisPedidosBoton";
import { MisPedidosPanel } from "@/components/mis-pedidos/MisPedidosPanel";
import { pedidosEnCamino } from "@/components/mis-pedidos/mis-pedidos.utils";
import { useMisPedidos } from "@/components/mis-pedidos/useMisPedidos";
import { MesaCerradaAviso } from "@/components/mesa-cerrada/MesaCerradaAviso";
import { CarritoBarra } from "@/components/carrito/CarritoBarra";
import { CarritoDetalle } from "@/components/carrito/CarritoDetalle";
import { CarritoHoja } from "@/components/carrito/CarritoHoja";
import {
  anuncioAgregado,
  cantidadEnCarrito,
  ID_TITULO_CARRITO,
} from "@/components/carrito/carrito.utils";
import { useEsPantallaAncha } from "@/components/carrito/useEsPantallaAncha";
import { useSesionMesaCerrada } from "@/components/mesa-cerrada/useSesionMesaCerrada";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  alcanzoCantidadMaxima,
  CANTIDAD_MAXIMA_POR_ITEM,
  codigoDeError,
  esEstablecimientoSuspendido,
  etiquetaMesa,
  headersMesaQr,
  MENSAJE_RESTAURANTE_NO_DISPONIBLE,
  mensajeErrorQr,
  origenPedido,
  solicitudAuthComensal,
  sumarUnidad,
  type OrigenMenu,
} from "@/components/menu-digital.utils";
import type { PedidoConfirmado } from "@/types/menu";
import {
  firmaCarrito,
  formatearPrecio,
  headersAccesoPedido,
  rutaPagos,
  type EstadoPagoDelPedido,
} from "@/components/pago/pago.utils";
import {
  almacenDelNavegador,
  borrarPedidoEnCurso,
  clavePedidoEnCurso,
  decidirRetoma,
  guardarPedidoEnCurso,
  leerPedidoEnCurso,
  retomaDeError,
  type PedidoEnCurso,
  type Retoma,
} from "@/components/pago/pedido-en-curso.utils";

const ItemNotaModal = dynamic(() => import("@/components/ItemNotaModal"), {
  ssr: false,
});
// BL-311: el formulario de Mercado Pago (SDK + iframes) se carga recién al
// ir a pagar, no con la carta.
const PagoPedido = dynamic(
  () =>
    import("@/components/pago/PagoPedido").then((mod) => ({
      default: mod.PagoPedido,
    })),
  { ssr: false, loading: () => null },
);
const PagoAprobado = dynamic(
  () =>
    import("@/components/pago/PagoAprobado").then((mod) => ({
      default: mod.PagoAprobado,
    })),
  { ssr: false, loading: () => null },
);

export type ItemMenu = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: string | number;
  disponible: boolean;
  imagenUrl: string | null;
};

export type CategoriaMenu = {
  id: string;
  nombre: string;
  items: ItemMenu[];
};

type ItemCarrito = {
  itemCartaId: string;
  nombre: string;
  precio: number;
  cantidad: number;
  imagenUrl: string | null;
  observacion?: string;
};

interface MenuDigitalProps {
  /** HU-034 (BL-204): en la mesa, solo el token del QR; ningún id. */
  readonly origen: OrigenMenu;
  readonly restaurante: { nombre: string; direccion?: string };
  readonly categorias: readonly CategoriaMenu[];
  /** Solo en la mesa: el número que se muestra en el encabezado. */
  readonly numeroMesa?: number;
}

const MAX_CHARS_GENERAL = 500;
const MAX_CHARS_ITEM = 300;

/**
 * Error de las notas del carrito antes de crear el pedido, o null si están
 * bien (el backend aplica los mismos topes).
 */
function errorNotas(
  carrito: readonly ItemCarrito[],
  observacionGeneral: string,
): string | null {
  if (observacionGeneral.length > MAX_CHARS_GENERAL) {
    return "La nota general no puede exceder 500 caracteres";
  }
  if (
    carrito.some((item) => (item.observacion ?? "").length > MAX_CHARS_ITEM)
  ) {
    return "Las notas de los ítems no pueden exceder 300 caracteres";
  }
  return null;
}

/** Token del comensal (mesa por QR o pedido web). BL-309 / BL-204 / BL-413. */
async function identificarComensal(origen: OrigenMenu): Promise<string> {
  // La ruta, el body y el header salen de menu-digital.utils.ts (con test),
  // para que no vuelvan a quedar apuntando a una ruta inexistente.
  const auth = solicitudAuthComensal(origen);
  const authRes = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}${auth.ruta}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(auth.body),
    },
  );
  if (authRes.ok) {
    const { accessToken } = await authRes.json();
    return accessToken;
  }
  // BL-413: establecimiento suspendido → «no disponible», no un error
  // genérico de identificación.
  const cuerpo = await authRes.json().catch(() => null);
  const mensaje = esEstablecimientoSuspendido(authRes.status, cuerpo)
    ? MENSAJE_RESTAURANTE_NO_DISPONIBLE
    : (mensajeErrorQr(origen, authRes.status, codigoDeError(cuerpo)) ??
      "Error al identificarte para hacer el pedido.");
  throw new ApiError(authRes.status, mensaje, codigoDeError(cuerpo));
}

/**
 * BL-448: con lo guardado de un pedido en curso, pide un JWT nuevo (el
 * anterior no se guarda) y consulta el estado real del pedido.
 */
async function consultarPedidoGuardado(
  origen: OrigenMenu,
  guardado: PedidoEnCurso,
): Promise<{ retoma: Retoma; accessToken?: string }> {
  try {
    const accessToken = await identificarComensal(origen);
    const estado = await apiFetch<EstadoPagoDelPedido>(
      rutaPagos(guardado.pedidoId),
      accessToken,
      { headers: headersAccesoPedido(origen, guardado.tokenAcceso) },
    );
    return { retoma: decidirRetoma(estado), accessToken };
  } catch (err) {
    return {
      retoma:
        err instanceof ApiError
          ? retomaDeError(err.status, err.codigo)
          : { accion: "conservar" },
    };
  }
}

/**
 * BL-311 (prepago, RD.03): crea el pedido, que queda en PENDIENTE_PAGO
 * hasta que se apruebe el pago.
 */
async function crearPedidoComensal(
  origen: OrigenMenu,
  carrito: readonly ItemCarrito[],
  observacionGeneral: string,
): Promise<{ pedido: PedidoConfirmado; accessToken: string }> {
  const accessToken = await identificarComensal(origen);
  const pedidoBody = {
    ...origenPedido(origen),
    idempotencyKey: crypto.randomUUID(),
    observacionGeneral: observacionGeneral.trim() || undefined,
    items: carrito.map((item) => ({
      itemCartaId: item.itemCartaId,
      cantidad: item.cantidad,
      observacion: item.observacion?.trim() || undefined,
    })),
  };
  const pedido = await apiFetch<PedidoConfirmado>("/pedidos", accessToken, {
    method: "POST",
    headers: headersMesaQr(origen),
    body: JSON.stringify(pedidoBody),
  });
  return { pedido, accessToken };
}

/** Mensaje para el comensal si no se pudo crear el pedido. */
function mensajeErrorAlPedir(origen: OrigenMenu, err: unknown): string {
  if (err instanceof ApiError) {
    return mensajeErrorQr(origen, err.status, err.codigo) ?? err.message;
  }
  return "No pudimos enviar tu pedido. Probá de nuevo.";
}

export default function MenuDigital({
  origen,
  restaurante,
  categorias,
  numeroMesa,
}: MenuDigitalProps) {
  const tipo = origen.tipo;
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [observacionGeneral, setObservacionGeneral] = useState("");
  const [itemNotaAbierto, setItemNotaAbierto] = useState<ItemCarrito | null>(
    null,
  );
  const [notaTemporal, setNotaTemporal] = useState("");

  const [estadoPedido, setEstadoPedido] = useState<
    "idle" | "enviando" | "error"
  >("idle");
  const [errorPedido, setErrorPedido] = useState<string | null>(null);

  // BL-311 (prepago, RD.03): el pedido creado espera el pago en la pantalla
  // «Pagar». Si el comensal vuelve a la carta y no cambia nada, se reusa el
  // mismo pedido (misma firma de carrito) en lugar de crear otro.
  const [vista, setVista] = useState<"carta" | "pago" | "aprobado">("carta");
  const [pedidoPorPagar, setPedidoPorPagar] = useState<{
    pedido: PedidoConfirmado;
    accessToken: string;
    firma: string;
  } | null>(null);
  // BL-311: lo que se pagó, para la pantalla de pago aprobado (el carrito ya
  // se vació).
  const [pagoAprobado, setPagoAprobado] = useState<{
    pedido: PedidoConfirmado;
    accessToken: string;
    lineas: ItemCarrito[];
    total: number;
  } | null>(null);

  // BL-448: aviso en la carta si el pedido guardado ya no se pudo retomar
  // (cancelado, mesa cerrada, inexistente).
  const [avisoRetoma, setAvisoRetoma] = useState<string | null>(null);
  const clave = clavePedidoEnCurso(origen);

  // BL-502: «Mis pedidos» en la mesa (los que pagó desde este teléfono en
  // la sesión abierta), con su estado en vivo.
  const misPedidos = useMisPedidos(origen, identificarComensal);
  // BL-518: si el mozo cierra la mesa, la carta se entera sin recargar.
  const mesaCerrada = useSesionMesaCerrada(origen, identificarComensal);
  const { recordar: recordarEnMisPedidos } = misPedidos;
  const [misPedidosAbierto, setMisPedidosAbierto] = useState(false);

  // BL-448: al abrir la carta (por ejemplo, después de recargar), si había
  // un pedido en curso en esta pestaña, se vuelve a donde estaba.
  useEffect(() => {
    const almacen = almacenDelNavegador(origen);
    const guardado = leerPedidoEnCurso(almacen, clave);
    if (!guardado) return;
    let cancelado = false;

    // consultarPedidoGuardado nunca rechaza: cualquier error lo convierte
    // en una decisión (descartar o conservar).
    void consultarPedidoGuardado(origen, guardado).then(
      ({ retoma, accessToken }) => {
        if (cancelado) return;
        const pedido = {
          id: guardado.pedidoId,
          estado: "PENDIENTE_PAGO" as const,
          createdAt: "",
          tokenAcceso: guardado.tokenAcceso,
        };
        const total = guardado.lineas.reduce(
          (t, l) => t + l.precio * l.cantidad,
          0,
        );
        if (retoma.accion === "pago" && accessToken) {
          setCarrito(guardado.lineas);
          setObservacionGeneral(guardado.observacionGeneral);
          setPedidoPorPagar({ pedido, accessToken, firma: guardado.firma });
          setVista("pago");
        } else if (retoma.accion === "aprobado" && accessToken) {
          guardarPedidoEnCurso(almacen, clave, { ...guardado, aprobado: true });
          recordarEnMisPedidos(guardado.pedidoId);
          setPagoAprobado({
            pedido,
            accessToken,
            lineas: guardado.lineas,
            total,
          });
          setVista("aprobado");
        } else if (retoma.accion === "descartar") {
          borrarPedidoEnCurso(almacen, clave);
          setAvisoRetoma(retoma.aviso);
        }
      },
    );
    return () => {
      cancelado = true;
    };
    // Solo al montar: el origen de la carta no cambia mientras está abierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  // BL-320: lo fijo de abajo tapaba los botones "Agregar" de los platos que
  // quedaban debajo. Se mide su alto para reservar ese espacio al final de la
  // página y en el scroll (ver el efecto de abajo). BL-519: en el celular lo
  // fijo es solo la barra del carrito; desde lg el carrito va a la derecha.
  const barraCarritoRef = useRef<HTMLDivElement>(null);
  const [altoBarraCarrito, setAltoBarraCarrito] = useState(0);
  const hayCarrito = carrito.length > 0 && vista === "carta";

  // BL-519: en el celular el carrito es una barra de una línea y el detalle
  // se abre en una hoja; desde lg sigue siendo la columna de la derecha.
  const esPantallaAncha = useEsPantallaAncha();
  const [hojaCarritoAbierta, setHojaCarritoAbierta] = useState(false);
  const barraCarritoVisible = hayCarrito && !esPantallaAncha;
  // BL-519: el último plato agregado, para anunciarlo al lector de pantalla.
  const [ultimoAgregado, setUltimoAgregado] = useState<string | null>(null);

  // BL-425: true si el ítem ya tiene en el carrito el máximo de unidades.
  const llegoAlTope = (itemId: string) =>
    alcanzoCantidadMaxima(cantidadEnCarrito(carrito, itemId));

  const agregarAlCarrito = (item: ItemMenu) => {
    setUltimoAgregado(item.nombre);
    setCarrito((prevCarrito) => {
      const itemExistente = prevCarrito.some((i) => i.itemCartaId === item.id);
      if (itemExistente) {
        return prevCarrito.map((i) =>
          // BL-425: no pasa del tope (el backend rechaza más de 99).
          i.itemCartaId === item.id
            ? { ...i, cantidad: sumarUnidad(i.cantidad) }
            : i,
        );
      }
      return [
        ...prevCarrito,
        {
          itemCartaId: item.id,
          nombre: item.nombre,
          precio: Number(item.precio),
          cantidad: 1,
          imagenUrl: item.imagenUrl,
          observacion: "",
        },
      ];
    });
  };

  const actualizarNotaItem = useCallback(
    (itemCartaId: string, nota: string) => {
      setCarrito((prevCarrito) => {
        const itemExistente = prevCarrito.find(
          (i) => i.itemCartaId === itemCartaId,
        );
        if (itemExistente?.observacion === nota) return prevCarrito;
        return prevCarrito.map((item) =>
          item.itemCartaId === itemCartaId
            ? { ...item, observacion: nota || undefined }
            : item,
        );
      });
    },
    [],
  );

  const handleAbrirNotaItem = (item: ItemCarrito) => {
    setItemNotaAbierto(item);
    setNotaTemporal(item.observacion || "");
  };

  const handleGuardarNotaItem = (nota: string) => {
    if (itemNotaAbierto) {
      actualizarNotaItem(itemNotaAbierto.itemCartaId, nota);
      setItemNotaAbierto(null);
    }
  };

  const vaciarCarrito = () => {
    setCarrito([]);
    setHojaCarritoAbierta(false);
  };

  const totalCarrito = useMemo(
    () =>
      carrito.reduce((total, item) => total + item.precio * item.cantidad, 0),
    [carrito],
  );

  const cantidadTotalItems = useMemo(
    () => carrito.reduce((total, item) => total + item.cantidad, 0),
    [carrito],
  );

  const continuarAlPago = async () => {
    const error = errorNotas(carrito, observacionGeneral);
    if (error) {
      setErrorPedido(error);
      return;
    }

    const firma = firmaCarrito(carrito, observacionGeneral);
    if (pedidoPorPagar?.firma === firma) {
      setHojaCarritoAbierta(false);
      setVista("pago");
      window.scrollTo({ top: 0 });
      return;
    }

    setEstadoPedido("enviando");
    setErrorPedido(null);
    try {
      const { pedido, accessToken } = await crearPedidoComensal(
        origen,
        carrito,
        observacionGeneral,
      );
      // BL-311: el pedido queda en PENDIENTE_PAGO; el carrito se conserva
      // hasta que el pago se apruebe.
      setPedidoPorPagar({ pedido, accessToken, firma });
      // BL-448: para retomarlo si se recarga la página. Reemplaza al pedido
      // anterior guardado (el carrito cambió).
      guardarPedidoEnCurso(almacenDelNavegador(origen), clave, {
        pedidoId: pedido.id,
        tokenAcceso: pedido.tokenAcceso,
        firma,
        lineas: carrito,
        observacionGeneral,
      });
      setAvisoRetoma(null);
      setEstadoPedido("idle");
      // BL-519: al volver del pago, la carta se ve con la barra, no con la
      // hoja abierta.
      setHojaCarritoAbierta(false);
      setVista("pago");
      window.scrollTo({ top: 0 });
    } catch (err) {
      setErrorPedido(mensajeErrorAlPedir(origen, err));
      setEstadoPedido("error");
    }
  };

  // BL-311: pago aprobado. El backend ya pasó el pedido a RECIBIDO y lo
  // mandó a cocina; se vacía el carrito y se muestra la pantalla de pago
  // aprobado (código, estado en vivo y comprobante).
  const alAprobarPago = useCallback(() => {
    if (!pedidoPorPagar) return;
    // BL-502: queda en «Mis pedidos» aunque después haga otro pedido.
    recordarEnMisPedidos(pedidoPorPagar.pedido.id);
    // BL-448: si recarga en la confirmación, vuelve a la confirmación.
    guardarPedidoEnCurso(almacenDelNavegador(origen), clave, {
      pedidoId: pedidoPorPagar.pedido.id,
      tokenAcceso: pedidoPorPagar.pedido.tokenAcceso,
      firma: pedidoPorPagar.firma,
      lineas: carrito,
      observacionGeneral,
      aprobado: true,
    });
    setPagoAprobado({
      pedido: pedidoPorPagar.pedido,
      accessToken: pedidoPorPagar.accessToken,
      lineas: carrito,
      total: totalCarrito,
    });
    setPedidoPorPagar(null);
    setCarrito([]);
    setObservacionGeneral("");
    setVista("aprobado");
    window.scrollTo({ top: 0 });
  }, [
    pedidoPorPagar,
    carrito,
    totalCarrito,
    clave,
    observacionGeneral,
    origen,
    recordarEnMisPedidos,
  ]);

  const hacerOtroPedido = useCallback(() => {
    // BL-448: el pedido terminó; no queda nada guardado (ni el token de
    // acceso de un pedido para retirar).
    // BL-502: el pedido sigue en «Mis pedidos».
    borrarPedidoEnCurso(almacenDelNavegador(origen), clave);
    setPagoAprobado(null);
    setVista("carta");
    window.scrollTo({ top: 0 });
  }, [clave, origen]);

  // BL-502: «Pedir algo más» desde «Mis pedidos»: a la carta.
  const pedirAlgoMas = useCallback(() => {
    setMisPedidosAbierto(false);
    if (vista === "aprobado") hacerOtroPedido();
    else setVista("carta");
  }, [vista, hacerOtroPedido]);
  const hayMisPedidos = misPedidos.pedidos.length > 0;

  // BL-320 / BL-519: mide la barra del carrito mientras está visible.
  useEffect(() => {
    const barra = barraCarritoRef.current;
    if (!barraCarritoVisible || !barra) {
      setAltoBarraCarrito(0);
      return;
    }
    const observer = new ResizeObserver(() =>
      setAltoBarraCarrito(Math.ceil(barra.getBoundingClientRect().height)),
    );
    observer.observe(barra);
    return () => observer.disconnect();
  }, [barraCarritoVisible]);

  // BL-320: scroll-padding hace que el navegador, al llevar un elemento a la
  // vista (scroll, foco con teclado, scrollIntoView), lo deje entre la barra
  // superior fija y la barra del carrito, en vez de debajo de alguna de las
  // dos. También cubre WCAG 2.4.11 (el foco no queda tapado).
  useEffect(() => {
    const html = document.documentElement;
    html.style.scrollPaddingTop = "5rem";
    html.style.scrollPaddingBottom = altoBarraCarrito
      ? `${altoBarraCarrito + 32}px`
      : "";
    return () => {
      html.style.scrollPaddingTop = "";
      html.style.scrollPaddingBottom = "";
    };
  }, [altoBarraCarrito]);

  // BL-311: pantallas del pago (pagar / pago aprobado); si no corresponde
  // ninguna, se muestra la carta.
  let pantallaPago: ReactNode = null;
  if (vista === "aprobado" && pagoAprobado) {
    pantallaPago = (
      <PagoAprobado
        origen={origen}
        pedidoId={pagoAprobado.pedido.id}
        tokenAcceso={pagoAprobado.pedido.tokenAcceso}
        accessToken={pagoAprobado.accessToken}
        lineas={pagoAprobado.lineas}
        total={pagoAprobado.total}
        numeroMesa={numeroMesa}
        onOtroPedido={hacerOtroPedido}
        nombreLocal={restaurante.nombre}
        pedidosEnCamino={pedidosEnCamino(
          misPedidos.pedidos.filter((p) => p.id !== pagoAprobado.pedido.id),
        )}
        onVerMisPedidos={() => setMisPedidosAbierto(true)}
      />
    );
  } else if (vista === "pago" && pedidoPorPagar) {
    pantallaPago = (
      <PagoPedido
        origen={origen}
        pedidoId={pedidoPorPagar.pedido.id}
        tokenAcceso={pedidoPorPagar.pedido.tokenAcceso}
        accessToken={pedidoPorPagar.accessToken}
        lineas={carrito}
        total={totalCarrito}
        numeroMesa={numeroMesa}
        onVolver={() => setVista("carta")}
        onAprobado={alAprobarPago}
      />
    );
  }

  // BL-519: lo mismo para la columna (lg) y para la hoja (celular).
  const propsDetalleCarrito = {
    lineas: carrito,
    cantidadTotal: cantidadTotalItems,
    total: totalCarrito,
    observacionGeneral,
    maxCaracteresGeneral: MAX_CHARS_GENERAL,
    onCambiarObservacion: setObservacionGeneral,
    onEditarNota: handleAbrirNotaItem,
    onVaciar: vaciarCarrito,
    onContinuar: continuarAlPago,
    enviando: estadoPedido === "enviando",
    error: errorPedido,
  };

  if (mesaCerrada) {
    return (
      <MesaCerradaAviso
        nombreLocal={restaurante.nombre}
        numeroMesa={numeroMesa}
      />
    );
  }

  return (
    <div
      className="min-h-screen bg-culinary-background pb-28"
      // BL-320: espacio al final para que el último plato pueda quedar por
      // encima de la barra del carrito.
      style={
        altoBarraCarrito ? { paddingBottom: altoBarraCarrito + 32 } : undefined
      }
    >
      <nav className="fixed top-0 w-full z-50 flex justify-between items-center px-4 md:px-8 h-16 bg-white border-b border-culinary-neutral/15">
        <div className="flex items-center gap-4">
          <span className="text-xl md:text-2xl font-bold text-[#6e54ad]">
            BistroLink
          </span>
        </div>
        <div className="flex items-center gap-2 md:gap-4 text-[#6e54ad]">
          {/* BL-502: en el celular, solo el ícono y la cantidad. */}
          {hayMisPedidos && (
            <MisPedidosBoton
              variante="nav"
              pedidos={misPedidos.pedidos}
              onAbrir={() => setMisPedidosAbierto(true)}
            />
          )}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#6e54ad]/10 rounded-full">
            <span className="text-sm font-medium">
              {tipo === "mesa"
                ? "📍 En el local"
                : "Pedido desde fuera del local"}
            </span>
          </div>
        </div>
      </nav>

      {pantallaPago ?? (
        <>
          {/* BL-320: en pantallas anchas (lg) el panel del pedido va a la
          derecha; con el carrito abierto se le reserva ese espacio para que
          la grilla del menú no quede debajo del panel. */}
          <main
            className={`pt-20 px-4 md:px-8 max-w-[1440px] mx-auto flex flex-col gap-10 ${hayCarrito ? "lg:pr-[448px]" : ""}`}
          >
            {avisoRetoma && (
              <output className="p-3 bg-amber-50 text-amber-900 rounded-lg text-sm font-medium flex items-start justify-between gap-3">
                <span>{avisoRetoma}</span>
                <button
                  type="button"
                  onClick={() => setAvisoRetoma(null)}
                  className="shrink-0 font-semibold underline"
                >
                  Cerrar
                </button>
              </output>
            )}
            <section className="w-full">
              <div className="relative w-full h-[250px] md:h-[350px] rounded-[1rem] overflow-hidden group bg-foreground">
                {/* LCP de la página: <img> en vez de background-image para que el
                navegador la descubra temprano, le dé prioridad alta y elija un
                tamaño acorde a la pantalla (Unsplash redimensiona por URL).
                Antes bajaba siempre 1974 px (~580 KB) y el LCP en mobile
                quedaba en ~6,5 s. Decorativa: el nombre ya está en el <h1>. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://images.unsplash.com/photo-1514933651103-005eec06c04b?q=60&w=828&auto=format&fit=crop"
                  srcSet={[640, 828, 1200, 1600]
                    .map(
                      (ancho) =>
                        `https://images.unsplash.com/photo-1514933651103-005eec06c04b?q=60&w=${ancho}&auto=format&fit=crop ${ancho}w`,
                    )
                    .join(", ")}
                  sizes="(min-width: 1440px) 1376px, calc(100vw - 2rem)"
                  alt=""
                  fetchPriority="high"
                  loading="eager"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover object-center transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10"></div>

                <div className="absolute bottom-0 left-0 p-6 md:p-8 w-full flex flex-col justify-end">
                  <span className="inline-flex items-center px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-white font-medium text-xs md:text-sm mb-3 w-max">
                    {tipo === "mesa"
                      ? etiquetaMesa(numeroMesa)
                      : `📍 ${restaurante.direccion || "Local"}`}
                  </span>
                  <h1 className="text-3xl md:text-5xl font-bold text-white mb-2 tracking-tight">
                    {restaurante.nombre}
                  </h1>
                </div>
              </div>
            </section>

            {categorias.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-[1rem] border border-culinary-neutral/15">
                <div className="text-6xl mb-4">🍽️</div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Menú no disponible
                </h2>
                <p className="text-[#5a575e]">
                  Este restaurante aún no tiene su menú publicado.
                </p>
              </div>
            ) : (
              <div className="space-y-12">
                {categorias.map((categoria, categoriaIndex) => (
                  <section
                    key={categoria.id}
                    id={`categoria-${categoria.id}`}
                    className="w-full"
                  >
                    <div className="flex items-center justify-between mb-6 border-b border-culinary-neutral/15 pb-2">
                      <h2 className="text-2xl font-bold text-foreground">
                        {categoria.nombre}
                      </h2>
                      <span className="text-sm font-medium text-[#5a575e]">
                        {categoria.items.length}{" "}
                        {categoria.items.length === 1 ? "ítem" : "ítems"}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {categoria.items.map((item, index) => (
                        <article
                          key={item.id}
                          {...(!item.disponible
                            ? { "aria-disabled": true }
                            : {})}
                          className={`bg-white rounded-[1rem] border border-culinary-neutral/15 flex flex-col sm:flex-row overflow-hidden hover:shadow-[0px_4px_20px_rgba(121,118,125,0.08)] transition-all group ${
                            !item.disponible
                              ? "bg-culinary-background grayscale-[0.2]"
                              : ""
                          }`}
                        >
                          <div
                            className={`w-full sm:w-2/5 h-48 sm:h-auto shrink-0 relative overflow-hidden bg-culinary-background ${
                              !item.disponible ? "opacity-50 grayscale" : ""
                            }`}
                          >
                            <ItemImagen
                              url={item.imagenUrl}
                              alt={item.nombre}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                              priority={categoriaIndex === 0 && index === 0}
                            />
                          </div>

                          <div className="p-5 flex flex-col justify-between flex-1">
                            <div>
                              <div className="flex justify-between items-start mb-2 gap-3">
                                <h3 className="font-semibold text-lg text-foreground leading-tight">
                                  {item.nombre}
                                </h3>
                                <span className="font-bold text-lg text-[#6e54ad] shrink-0">
                                  {formatearPrecio(item.precio)}
                                </span>
                              </div>
                              {item.descripcion && (
                                <p className="text-sm text-[#5a575e] mb-4 line-clamp-2">
                                  {item.descripcion}
                                </p>
                              )}
                            </div>

                            <div className="mt-4 sm:mt-auto flex flex-col gap-3">
                              {!item.disponible ? (
                                <span className="inline-flex rounded-md bg-red-100 text-red-800 px-3 py-2 text-sm font-semibold items-center justify-center gap-1">
                                  <span role="img" aria-label="Agotado">
                                    🚫
                                  </span>{" "}
                                  No disponible
                                </span>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => agregarAlCarrito(item)}
                                    // BL-425: al llegar al tope el botón se deshabilita
                                    // y el aviso queda asociado con aria-describedby.
                                    disabled={llegoAlTope(item.id)}
                                    aria-describedby={
                                      llegoAlTope(item.id)
                                        ? `tope-${item.id}`
                                        : undefined
                                    }
                                    aria-label={`Agregar ${item.nombre} al carrito`}
                                    className="w-full bg-[#6e54ad]/10 text-[#6e54ad] font-semibold py-2.5 rounded-[0.5rem] hover:bg-[#6e54ad] hover:text-white transition-colors flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#6e54ad]/10 disabled:hover:text-[#6e54ad]"
                                  >
                                    <svg
                                      aria-hidden="true"
                                      xmlns="http://www.w3.org/2000/svg"
                                      width="20"
                                      height="20"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <line
                                        x1="12"
                                        y1="5"
                                        x2="12"
                                        y2="19"
                                      ></line>
                                      <line
                                        x1="5"
                                        y1="12"
                                        x2="19"
                                        y2="12"
                                      ></line>
                                    </svg>
                                    Agregar
                                    {/* BL-519: en el celular el detalle del
                                    carrito no se ve; el botón muestra cuántos
                                    hay (el lector de pantalla lo oye en el
                                    anuncio de abajo). */}
                                    {cantidadEnCarrito(carrito, item.id) >
                                      0 && (
                                      <span
                                        aria-hidden="true"
                                        className="ml-1 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-[#6e54ad]"
                                      >
                                        {cantidadEnCarrito(carrito, item.id)} en
                                        el pedido
                                      </span>
                                    )}
                                  </button>
                                  {llegoAlTope(item.id) && (
                                    <p
                                      id={`tope-${item.id}`}
                                      className="text-xs text-[#5a575e] text-center"
                                    >
                                      Máximo {CANTIDAD_MAXIMA_POR_ITEM} unidades
                                      por ítem.
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}

            {origen.tipo === "mesa" && (
              <div className="mt-8 flex justify-center w-full">
                <LlamarMozoButton
                  qrToken={origen.qrToken}
                  sesionMesa={origen.sesionMesa}
                />
              </div>
            )}

            {/* HU-036 (BL-206): política de privacidad del local. */}
            <footer className="pb-4 text-center text-sm text-[#5a575e]">
              <a
                href={rutaPrivacidad(origen)}
                className="underline hover:text-[#6e54ad]"
              >
                Política de privacidad
              </a>
            </footer>
          </main>

          {/* BL-519: el carrito se muestra en un solo lugar a la vez: la
          columna de la derecha desde lg, o la barra con la hoja en el
          celular. */}
          {hayCarrito && esPantallaAncha && (
            <aside
              aria-labelledby={ID_TITULO_CARRITO}
              // BL-320: desde lg va a la derecha, en el espacio que se le
              // reserva al <main>.
              className="fixed bottom-4 right-4 w-[400px] max-h-[calc(100vh-6rem)] overflow-y-auto bg-white rounded-[1rem] shadow-[0px_4px_20px_rgba(121,118,125,0.15)] border border-culinary-neutral/15 p-5 z-20"
            >
              <CarritoDetalle {...propsDetalleCarrito} variante="columna" />
            </aside>
          )}

          {barraCarritoVisible && (
            <>
              <div
                ref={barraCarritoRef}
                className="fixed bottom-4 left-4 right-4 z-20 lg:hidden"
              >
                <CarritoBarra
                  cantidad={cantidadTotalItems}
                  total={totalCarrito}
                  onAbrir={() => setHojaCarritoAbierta(true)}
                />
              </div>
              <CarritoHoja
                abierto={hojaCarritoAbierta}
                onCerrar={() => setHojaCarritoAbierta(false)}
              >
                <CarritoDetalle
                  {...propsDetalleCarrito}
                  variante="hoja"
                  onCerrar={() => setHojaCarritoAbierta(false)}
                />
              </CarritoHoja>
            </>
          )}

          {/* BL-519: aviso para el lector de pantalla al agregar un plato. */}
          <output aria-live="polite" className="sr-only">
            {hayCarrito && ultimoAgregado
              ? anuncioAgregado(
                  ultimoAgregado,
                  cantidadTotalItems,
                  totalCarrito,
                )
              : ""}
          </output>

          {/* BL-502: en el celular, «Mis pedidos» abajo mientras no hay
          carrito (con carrito, la barra del carrito ocupa ese lugar y queda
          el botón de la barra superior). Desde lg, solo el de la barra. */}
          {hayMisPedidos && !hayCarrito && (
            <div className="fixed bottom-4 left-4 right-4 z-20 lg:hidden">
              <MisPedidosBoton
                variante="barra"
                pedidos={misPedidos.pedidos}
                onAbrir={() => setMisPedidosAbierto(true)}
              />
            </div>
          )}
        </>
      )}

      {origen.tipo === "mesa" && (
        <MisPedidosPanel
          abierto={misPedidosAbierto}
          onCerrar={() => setMisPedidosAbierto(false)}
          onPedirAlgoMas={pedirAlgoMas}
          origen={origen}
          numeroMesa={numeroMesa}
          pedidos={misPedidos.pedidos}
          lugares={misPedidos.lugares}
          accessToken={misPedidos.accessToken}
        />
      )}

      <ItemNotaModal
        isOpen={!!itemNotaAbierto}
        onClose={() => setItemNotaAbierto(null)}
        itemName={itemNotaAbierto?.nombre || ""}
        currentNote={notaTemporal}
        onSave={handleGuardarNotaItem}
      />
    </div>
  );
}
