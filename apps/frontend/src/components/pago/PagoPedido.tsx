'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { LlamarMozoButton } from '@/components/LlamarMozoButton';
import { etiquetaDelPedidoAPagar, type OrigenMenu } from '@/components/menu-digital.utils';
import { rutaPrivacidad } from '@/components/privacidad/privacidad.utils';
import { FormularioTarjeta, IconoCandado, type DatosTarjeta } from './FormularioTarjeta';
import { EsperandoMozo, FormularioEfectivo, SelectorMetodoPago } from './PagoEfectivo';
import {
  FacturaConRut,
  ID_CONSENTIMIENTO_FACTURA,
  ID_RAZON_SOCIAL_FACTURA,
  ID_RUT_FACTURA,
} from './FacturaConRut';
import {
  erroresFactura,
  FACTURA_VACIA,
  receptorParaEnviar,
  type FormularioFactura,
} from './factura.utils';
import {
  codigoPedido,
  formatearPrecio,
  headersAccesoPedido,
  INTERVALO_CONSULTA_EFECTIVO_MS,
  INTERVALO_CONSULTA_MS,
  MEDIOS_SIN_CONSULTA,
  mediosDisponibles,
  mediosSegunOrigen,
  mensajeSinMedios,
  metodoSegunMedios,
  opcionesDePago,
  pantallaAlAbrir,
  resultadoDeError,
  resultadoDeEstado,
  rutaPagos,
  rutaPropina,
  rutaSolicitudEfectivo,
  seguirConsultando,
  TOPE_CONSULTA_EFECTIVO_MS,
  type EstadoPago,
  type EstadoPagoDelPedido,
  type MediosDisponibles,
  type MetodoPago,
  type OpcionesPago,
  type ResultadoPago,
  type SolicitudEfectivo,
} from './pago.utils';
import { SelectorPropina } from './SelectorPropina';
import {
  cuerpoDePropina,
  eleccionAlAbrir,
  eleccionGuardada,
  etiquetaDePropina,
  hayQueGuardarPropina,
  MENSAJE_ERROR_PROPINA,
  mensajeErrorPropina,
  montoDePropina,
  SIN_PROPINA,
  totalConPropina,
  type EleccionPropina,
  type PropinaDelLocal,
  type TotalesDelPedido,
} from './propina.utils';

export interface LineaResumen {
  readonly itemCartaId: string;
  readonly nombre: string;
  readonly cantidad: number;
  readonly precio: number;
  readonly observacion?: string;
}

interface PagoPedidoProps {
  readonly origen: OrigenMenu;
  readonly pedidoId: string;
  /** Solo pedidos para retirar: el token que devolvió POST /pedidos (RD.05). */
  readonly tokenAcceso?: string;
  /** JWT del comensal técnico del tenant. */
  readonly accessToken: string;
  readonly lineas: readonly LineaResumen[];
  /**
   * El consumo del carrito, con IVA incluido y sin propina. HU-022 (BL-495):
   * lo que se cobra es el consumo más la propina que elige el comensal acá;
   * si el backend informa su propio consumo, ese manda.
   */
  readonly total: number;
  readonly numeroMesa?: number;
  /** HU-033 (BL-203): sin carta (link de pago), no hay «Volver a la carta». */
  readonly onVolver?: () => void;
  readonly onAprobado: () => void;
}

type Pantalla =
  | { tipo: 'formulario' }
  | { tipo: 'procesando' }
  | { tipo: 'rechazado'; mensaje: string }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'verificando'; mensaje: string; agotado: boolean }
  // HU-031b (BL-442): avisó al mozo que paga en efectivo y lo espera.
  | {
      tipo: 'esperandoEfectivo';
      pagaCon: string | null;
      aviso: string | null;
      agotado: boolean;
    };

interface PagoCreado {
  estado: EstadoPago;
}

/** HU-022 (BL-495): respuesta de PUT .../pagos/propina (backend: PropinaElegida). */
interface PropinaGuardada {
  propinaPorcentaje: number | null;
  propinaMonto: number | null;
  consumo: string;
  propina: string;
  total: string;
}

/**
 * BL-311 (HU-007): pantalla «Pagar» del comensal (mesa o pedido para retirar).
 *
 * Prepago (RD.03): el pedido ya existe en PENDIENTE_PAGO; acá se cobra con
 * tarjeta (Mercado Pago) y, con el pago aprobado, el backend lo manda a
 * cocina. Estados:
 * - formulario / procesando: carga de la tarjeta y cobro.
 * - rechazado: la tarjeta no autorizó; no hubo cargo y se puede reintentar.
 * - verificando: la pasarela no respondió o el pago quedó pendiente; se
 *   consulta GET /pedidos/:id/pagos hasta tener el resultado real. Mientras
 *   tanto NO se ofrece pagar de nuevo (evita un doble cobro).
 *
 * BL-452: solo se ofrecen los medios que el local tiene habilitados (HU-020):
 * la tarjeta si tiene Mercado Pago y el efectivo en pedidos de mesa de un
 * local que lo acepta. Sin ninguno, se le avisa al comensal a quién pagarle.
 *
 * HU-022 (BL-495): propina voluntaria, para todos los comensales (mesa y para
 * retirar). Se elige antes de los medios de pago y se guarda en el pedido
 * (PUT .../propina) justo antes de pagar o de avisar al mozo, para que la
 * tarjeta, el efectivo y el POS cobren lo mismo. Mientras se confirma un pago
 * o se espera al mozo, ya no se puede cambiar.
 */
export function PagoPedido({
  origen,
  pedidoId,
  tokenAcceso,
  accessToken,
  lineas,
  total,
  numeroMesa,
  onVolver,
  onAprobado,
}: PagoPedidoProps) {
  const [pantalla, setPantalla] = useState<Pantalla>({ tipo: 'formulario' });
  // Cambia en cada rechazo para volver a montar el formulario vacío (el
  // token de la tarjeta es de un solo uso).
  const [intento, setIntento] = useState(0);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  // BL-452: medios que el local ofrece para este pedido (lo dice el backend
  // en GET .../pagos). null mientras se consulta.
  const [medios, setMedios] = useState<MediosDisponibles | null>(null);
  const [metodo, setMetodo] = useState<MetodoPago>('tarjeta');
  const [avisandoMozo, setAvisandoMozo] = useState(false);
  const [errorEfectivo, setErrorEfectivo] = useState<string | null>(null);
  // HU-009 (BL-453): e-Factura con RUT y razón social.
  const [factura, setFactura] = useState<FormularioFactura>(FACTURA_VACIA);
  const [erroresFacturaVisibles, setErroresFacturaVisibles] = useState(false);
  // HU-022 (BL-495): propina. El consumo arranca con el del carrito y pasa al
  // del backend cuando la consulta lo trae. Lo que ofrece el local y lo que
  // el pedido tiene guardado llegan con la misma consulta; un backend anterior
  // no los trae y entonces no se ofrece propina.
  const [consumo, setConsumo] = useState<number>(total);
  const [propinaLocal, setPropinaLocal] = useState<PropinaDelLocal | null>(null);
  const [totalesGuardados, setTotalesGuardados] = useState<TotalesDelPedido | null>(
    null,
  );
  const [eleccion, setEleccion] = useState<EleccionPropina>(SIN_PROPINA);
  // true: la marcó el local (preselección) y el comensal todavía no tocó nada.
  const [sugerida, setSugerida] = useState(false);
  const [errorPropina, setErrorPropina] = useState<string | null>(null);
  const errorPropinaRef = useRef<HTMLParagraphElement>(null);

  const headers = headersAccesoPedido(origen, tokenAcceso);

  // Lo que se cobra: consumo más propina. El backend lo vuelve a calcular.
  const montoPropina = montoDePropina(consumo, eleccion);
  const totalAPagar = totalConPropina(consumo, eleccion);

  /**
   * HU-009 (BL-453): antes de pagar o de avisar al mozo. Si cargó datos de
   * la e-Factura sin aceptar el aviso, o con el aviso aceptado faltan datos,
   * se muestran los errores, el foco va al primero y no se paga.
   */
  function facturaLista(): boolean {
    const errores = erroresFactura(factura);
    let campo: string | null = null;
    if (errores.consentimiento) campo = ID_CONSENTIMIENTO_FACTURA;
    else if (errores.rut) campo = ID_RUT_FACTURA;
    else if (errores.razonSocial) campo = ID_RAZON_SOCIAL_FACTURA;
    if (!campo) return true;
    setErroresFacturaVisibles(true);
    document.getElementById(campo)?.focus();
    return false;
  }
  const cantidadItems = lineas.reduce((acc, l) => acc + l.cantidad, 0);

  /**
   * HU-022 (BL-495): guarda la propina en el pedido antes de pagar o de
   * avisar al mozo. No hace nada si lo que se ve ya es lo guardado (incluido
   * «sin propina» sin nada guardado). Devuelve false, con el motivo a la
   * vista, si no se pudo guardar: en ese caso no se paga.
   */
  async function guardarPropina(): Promise<boolean> {
    if (!totalesGuardados || !hayQueGuardarPropina(eleccion, totalesGuardados)) {
      return true;
    }
    setErrorPropina(null);
    try {
      const guardada = await apiFetch<PropinaGuardada>(
        rutaPropina(pedidoId),
        accessToken,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify(cuerpoDePropina(eleccion)),
        },
      );
      setTotalesGuardados({
        consumo: guardada.consumo,
        propina: guardada.propina,
        total: guardada.total,
        propinaPorcentaje: guardada.propinaPorcentaje,
        propinaMonto: guardada.propinaMonto,
      });
      setConsumo(Number(guardada.consumo));
      return true;
    } catch (err) {
      setErrorPropina(
        err instanceof ApiError
          ? mensajeErrorPropina(err.status, err.message)
          : MENSAJE_ERROR_PROPINA,
      );
      return false;
    }
  }

  // Un error al guardar la propina se avisa donde se eligió, aunque el
  // comensal haya tocado el botón de más abajo.
  useEffect(() => {
    if (errorPropina) {
      errorPropinaRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [errorPropina]);

  const aplicarResultado = useCallback(
    (resultado: ResultadoPago) => {
      if (resultado.tipo === 'aprobado') {
        onAprobado();
        return;
      }
      if (resultado.tipo === 'verificando') {
        setPantalla({ tipo: 'verificando', mensaje: resultado.mensaje, agotado: false });
        return;
      }
      if (resultado.tipo === 'rechazado') setIntento((n) => n + 1);
      setPantalla(resultado);
    },
    [onAprobado],
  );

  // Al cambiar de estado, el foco va al título: un lector de pantalla
  // anuncia el resultado sin que el comensal tenga que buscarlo.
  useEffect(() => {
    if (pantalla.tipo !== 'procesando') tituloRef.current?.focus();
  }, [pantalla.tipo]);

  async function pagar(datos: DatosTarjeta) {
    const anterior = pantalla;
    setPantalla({ tipo: 'procesando' });
    // HU-022 (BL-495): primero la propina; si no se guarda, no se cobra.
    if (!(await guardarPropina())) {
      setPantalla(anterior);
      return;
    }
    try {
      const pago = await apiFetch<PagoCreado>(rutaPagos(pedidoId), accessToken, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          medioPago: 'MERCADOPAGO',
          datosPasarela: datos,
          receptorFiscal: receptorParaEnviar(factura),
        }),
      });
      aplicarResultado(resultadoDeEstado(pago.estado));
    } catch (err) {
      aplicarResultado(
        err instanceof ApiError
          ? resultadoDeError(err.status, err.message)
          : resultadoDeError(0),
      );
    }
  }

  // Verificando: consulta el estado real hasta que se resuelve o se agota.
  const verificando = pantalla.tipo === 'verificando' && !pantalla.agotado;
  useEffect(() => {
    if (!verificando) return;
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout>;
    const inicio = Date.now();

    const consultar = async () => {
      try {
        const estado = await apiFetch<EstadoPagoDelPedido>(
          rutaPagos(pedidoId),
          accessToken,
          { headers },
        );
        if (cancelado) return;
        const resultado = resultadoDeEstado(
          estado.pago?.estado,
          estado.pago?.motivoRechazo,
        );
        if (resultado.tipo !== 'verificando') {
          aplicarResultado(resultado);
          return;
        }
      } catch {
        // Un error de red no resuelve nada: se vuelve a intentar.
      }
      if (cancelado) return;
      if (seguirConsultando(inicio, Date.now())) {
        timer = setTimeout(consultar, INTERVALO_CONSULTA_MS);
      } else {
        setPantalla((p) => (p.tipo === 'verificando' ? { ...p, agotado: true } : p));
      }
    };

    timer = setTimeout(consultar, INTERVALO_CONSULTA_MS);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
    // headers se arma en cada render con los mismos valores: no es dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verificando, pedidoId, accessToken, aplicarResultado]);

  // Al abrir la pantalla (también al retomar después de recargar, BL-448)
  // se consulta el estado real del pedido:
  // - BL-452: qué medios ofrece el local.
  // - HU-031b (BL-442): en un pedido de mesa, si el comensal ya había
  //   avisado que paga en efectivo, sigue esperando al mozo.
  // - BL-448: si ya hay un pago con tarjeta en curso, se espera su resultado
  //   en lugar de ofrecer pagar de nuevo (evita un doble cobro).
  // - HU-022 (BL-495): la propina guardada en el pedido, o la que preselecciona
  //   el local si no hay nada guardado.
  const esMesa = origen.tipo === 'mesa';
  useEffect(() => {
    let cancelado = false;
    apiFetch<EstadoPagoDelPedido>(rutaPagos(pedidoId), accessToken, { headers })
      .then((estado) => {
        if (cancelado) return;
        // HU-033 (BL-203): por el link, solo tarjeta.
        const disponibles = mediosSegunOrigen(
          mediosDisponibles(estado),
          origen.tipo,
        );
        setMedios(disponibles);
        setMetodo((actual) => metodoSegunMedios(disponibles, actual));
        const pantallaInicial = pantallaAlAbrir(estado, esMesa);

        if (estado.propina) setPropinaLocal(estado.propina);
        if (estado.totales) {
          setConsumo(Number(estado.totales.consumo));
          setTotalesGuardados(estado.totales);
          // Con el aviso al mozo o un pago en curso la propina ya está
          // definida: vale la guardada, no la preselección del local.
          const inicial =
            estado.propina && pantallaInicial === 'formulario'
              ? eleccionAlAbrir(estado.totales, estado.propina)
              : { eleccion: eleccionGuardada(estado.totales), sugerida: false };
          setEleccion(inicial.eleccion);
          setSugerida(inicial.sugerida);
        }

        if (pantallaInicial === 'efectivo') {
          setMetodo('efectivo');
          setPantalla({
            tipo: 'esperandoEfectivo',
            pagaCon: estado.efectivo?.pagaCon ?? null,
            aviso: null,
            agotado: false,
          });
        } else if (pantallaInicial === 'verificando') {
          setPantalla({
            tipo: 'verificando',
            mensaje: 'Estamos confirmando tu pago con tarjeta.',
            agotado: false,
          });
        }
      })
      .catch(() => {
        // Sin la consulta, se ofrece solo la tarjeta (como antes): si el
        // local la deshabilitó, la API responde 409 con el motivo.
        if (!cancelado) setMedios(MEDIOS_SIN_CONSULTA);
      });
    return () => {
      cancelado = true;
    };
    // headers se arma en cada render con los mismos valores: no es dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esMesa, pedidoId, accessToken]);

  /**
   * `conFactura`: el primer aviso manda la e-Factura (o null si no la pidió).
   * «Avisar de nuevo» no la manda: después de recargar, el formulario está
   * vacío y borraría lo que ya se guardó.
   */
  async function avisarAlMozo(pagaCon: string | null, conFactura = true) {
    setAvisandoMozo(true);
    setErrorEfectivo(null);
    try {
      // HU-022 (BL-495): el mozo cobra lo que ve el comensal, con la propina
      // ya guardada en el pedido.
      if (!(await guardarPropina())) return;
      const solicitud = await apiFetch<SolicitudEfectivo>(
        rutaSolicitudEfectivo(pedidoId),
        accessToken,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...(pagaCon ? { pagaCon } : {}),
            ...(conFactura ? { receptorFiscal: receptorParaEnviar(factura) } : {}),
          }),
        },
      );
      setPantalla({
        tipo: 'esperandoEfectivo',
        pagaCon: solicitud.pagaCon,
        aviso: solicitud.avisado ? null : 'Ya le avisamos al mozo hace un momento.',
        agotado: false,
      });
    } catch (err) {
      // 409 (el local no acepta efectivo, ya pagado, tarjeta en curso), 400
      // y 410 (la mesa se cerró) llegan con el mensaje del backend.
      setErrorEfectivo(
        err instanceof ApiError
          ? err.message
          : 'No pudimos avisarle al mozo. Probá de nuevo.',
      );
    } finally {
      setAvisandoMozo(false);
    }
  }

  // Esperando al mozo: consulta hasta que registra el cobro (pago APROBADO).
  const esperandoMozo = pantalla.tipo === 'esperandoEfectivo' && !pantalla.agotado;
  useEffect(() => {
    if (!esperandoMozo) return;
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout>;
    const inicio = Date.now();

    const consultar = async () => {
      try {
        const estado = await apiFetch<EstadoPagoDelPedido>(
          rutaPagos(pedidoId),
          accessToken,
          { headers },
        );
        if (cancelado) return;
        if (estado.pago?.estado === 'APROBADO') {
          onAprobado();
          return;
        }
        if (estado.estadoPedido === 'CANCELADO') {
          setPantalla({
            tipo: 'error',
            mensaje: 'Tu pedido se canceló. Si querés, hacé uno nuevo desde la carta.',
          });
          return;
        }
      } catch {
        // Un error de red no resuelve nada: se vuelve a intentar.
      }
      if (cancelado) return;
      if (Date.now() - inicio < TOPE_CONSULTA_EFECTIVO_MS) {
        timer = setTimeout(consultar, INTERVALO_CONSULTA_EFECTIVO_MS);
      } else {
        setPantalla((p) =>
          p.tipo === 'esperandoEfectivo' ? { ...p, agotado: true } : p,
        );
      }
    };

    timer = setTimeout(consultar, INTERVALO_CONSULTA_EFECTIVO_MS);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
    // headers se arma en cada render con los mismos valores: no es dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esperandoMozo, pedidoId, accessToken, onAprobado]);

  const bloqueado =
    pantalla.tipo === 'procesando' ||
    pantalla.tipo === 'verificando' ||
    pantalla.tipo === 'esperandoEfectivo';

  // La e-Factura y la propina se piden juntas, antes de los medios de pago.
  // La propina, solo si el backend informa lo que ofrece el local y lo que
  // el pedido tiene guardado.
  const pideDatos = pideComprobante(pantalla, medios);
  const muestraPropina = pideDatos && propinaLocal !== null && totalesGuardados !== null;

  return (
    <div className="pt-20 pb-12 px-4 md:px-8 max-w-[1100px] mx-auto">
      {onVolver && (
        <button
          type="button"
          onClick={onVolver}
          disabled={bloqueado}
          className="inline-flex items-center gap-2 text-sm font-medium text-[#5a575e] hover:text-[#6e54ad] disabled:opacity-40 disabled:cursor-not-allowed mb-6"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
          Volver a la carta
        </button>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="flex flex-col gap-6">
          <section className="bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 md:p-6 shadow-[0px_4px_20px_rgba(121,118,125,0.08)]">
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#5a575e]">
                {etiquetaDelPedidoAPagar(origen.tipo, numeroMesa)}
              </span>
              <span className="text-xs font-semibold text-[#6e54ad] bg-[#6e54ad]/10 px-2.5 py-1 rounded-full">
                Pedido {codigoPedido(pedidoId)}
              </span>
            </div>
            <h1
              ref={tituloRef}
              tabIndex={-1}
              className="text-2xl md:text-3xl font-bold text-foreground tracking-tight outline-none"
            >
              {tituloDe(pantalla)}
            </h1>
            <p className="mt-1 text-sm text-[#5a575e]">{bajadaDe(pantalla)}</p>

            {pantalla.tipo === 'rechazado' && (
              <AvisoRechazo mensaje={pantalla.mensaje} total={totalAPagar} />
            )}
            {pantalla.tipo === 'error' && (
              <p role="alert" className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm font-medium">
                {pantalla.mensaje}
              </p>
            )}
          </section>

          {/* HU-009 (BL-453): antes de elegir cómo pagar; no mientras se
              confirma un pago ni mientras espera al mozo. */}
          {pideDatos && (
            <FacturaConRut
              valor={factura}
              onCambiar={(nuevo) => {
                setFactura(nuevo);
                if (!nuevo.quiere) setErroresFacturaVisibles(false);
              }}
              mostrarErrores={erroresFacturaVisibles}
              rutaPrivacidad={rutaPrivacidad(origen)}
              deshabilitado={pantalla.tipo === 'procesando' || avisandoMozo}
            />
          )}

          {/* HU-022 (BL-495): propina voluntaria, entre la e-Factura y los
              medios de pago. Sin elegir nada no hay propina y se puede pagar. */}
          {muestraPropina && (
            <>
              <SelectorPropina
                consumo={consumo}
                sugeridas={propinaLocal.sugeridas}
                eleccion={eleccion}
                sugerida={sugerida}
                deshabilitado={pantalla.tipo === 'procesando' || avisandoMozo}
                onElegir={(nueva) => {
                  setEleccion(nueva);
                  setSugerida(false);
                  setErrorPropina(null);
                }}
              />
              {errorPropina && (
                <p
                  ref={errorPropinaRef}
                  role="alert"
                  className="-mt-3 p-3 rounded-lg bg-red-50 text-red-700 text-sm font-medium"
                >
                  {errorPropina}
                </p>
              )}
            </>
          )}

          <MetodosDePago
            pantalla={pantalla}
            opciones={medios && opcionesDePago(medios)}
            sinMedios={
              <SinMediosDePago
                mensaje={mensajeSinMedios(origen.tipo)}
                llamarMozo={
                  origen.tipo === 'mesa' && (
                    <LlamarMozoButton
                      qrToken={origen.qrToken}
                      sesionMesa={origen.sesionMesa}
                    />
                  )
                }
              />
            }
            metodo={metodo}
            onCambiarMetodo={(m) => {
              setMetodo(m);
              setErrorEfectivo(null);
            }}
            tarjeta={
              <section
                aria-labelledby="metodo-pago"
                className="bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 md:p-6 shadow-[0px_4px_20px_rgba(121,118,125,0.08)]"
              >
                <div className="flex items-center justify-between gap-3 mb-5">
                  <h2 id="metodo-pago" className="text-lg font-bold text-foreground">
                    Tarjeta de débito o crédito
                  </h2>
                  <span className="hidden sm:inline-flex items-center gap-1 text-xs text-[#5a575e] shrink-0">
                    <IconoCandado /> Pago protegido
                  </span>
                </div>
                <FormularioTarjeta
                  key={intento}
                  monto={totalAPagar}
                  procesando={pantalla.tipo === 'procesando'}
                  textoBoton={
                    pantalla.tipo === 'rechazado'
                      ? `Reintentar pago (${formatearPrecio(totalAPagar)})`
                      : undefined
                  }
                  onPagar={pagar}
                  puedePagar={facturaLista}
                />
                {/* HU-036 (BL-206): aviso antes de pedir correo y documento. */}
                <p className="mt-4 text-xs text-[#5a575e]">
                  Tu correo y tu documento se envían a Mercado Pago para procesar el pago
                  y enviarte el comprobante; BistroLink no los guarda.{' '}
                  <a href={rutaPrivacidad(origen)} className="underline hover:text-[#6e54ad]">
                    Política de privacidad
                  </a>
                </p>
              </section>
            }
            efectivo={
              <FormularioEfectivo
                total={totalAPagar}
                enviando={avisandoMozo}
                error={errorEfectivo}
                onAvisar={(pagaCon) => void avisarAlMozo(pagaCon)}
                puedeAvisar={facturaLista}
              />
            }
            verificando={
              pantalla.tipo === 'verificando' && (
                <Verificando
                  mensaje={pantalla.mensaje}
                  agotado={pantalla.agotado}
                  onReintentarConsulta={() => setPantalla({ ...pantalla, agotado: false })}
                />
              )
            }
            esperandoMozo={
              pantalla.tipo === 'esperandoEfectivo' && (
                <EsperandoMozo
                  total={totalAPagar}
                  pagaCon={pantalla.pagaCon}
                  aviso={pantalla.aviso}
                  agotado={pantalla.agotado}
                  enviando={avisandoMozo}
                  onAvisarDeNuevo={() => void avisarAlMozo(pantalla.pagaCon, false)}
                  onConsultar={() => setPantalla({ ...pantalla, agotado: false })}
                  onPagarConTarjeta={
                    medios?.tarjeta === false
                      ? undefined
                      : () => {
                          setMetodo('tarjeta');
                          setPantalla({ tipo: 'formulario' });
                        }
                  }
                />
              )
            }
          />

          {origen.tipo === 'mesa' && pantalla.tipo === 'rechazado' && (
            <section className="bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-[#5a575e]">
                {/* HU-031b (BL-442): si hay efectivo, ya está entre las opciones. */}
                {medios?.efectivo
                  ? '¿Preferís pagar con el POS del local?'
                  : '¿Preferís pagar en efectivo o con el POS del local?'}
              </p>
              <LlamarMozoButton
              qrToken={origen.qrToken}
              sesionMesa={origen.sesionMesa}
            />
            </section>
          )}
        </div>

        <ResumenPedido
          lineas={lineas}
          consumo={consumo}
          propina={
            eleccion.tipo === 'ninguna'
              ? null
              : { etiqueta: etiquetaDePropina(eleccion), monto: montoPropina }
          }
          total={totalAPagar}
          cantidadItems={cantidadItems}
        />
      </div>
    </div>
  );
}

/**
 * Qué se muestra debajo del encabezado: el pago en verificación, la espera
 * del mozo (efectivo) o el método elegido, con el selector si el pedido
 * admite los dos medios (HU-031b, BL-442). BL-452: con un solo medio, ese
 * medio directo; sin ninguno, el aviso; mientras se consulta, un indicador.
 */
function MetodosDePago({
  pantalla,
  opciones,
  sinMedios,
  metodo,
  onCambiarMetodo,
  tarjeta,
  efectivo,
  verificando,
  esperandoMozo,
}: {
  readonly pantalla: Pantalla;
  readonly opciones: OpcionesPago | null;
  readonly sinMedios: ReactNode;
  readonly metodo: MetodoPago;
  readonly onCambiarMetodo: (metodo: MetodoPago) => void;
  readonly tarjeta: ReactNode;
  readonly efectivo: ReactNode;
  readonly verificando: ReactNode;
  readonly esperandoMozo: ReactNode;
}) {
  if (pantalla.tipo === 'verificando') return verificando;
  if (pantalla.tipo === 'esperandoEfectivo') return esperandoMozo;
  if (!opciones) return <CargandoMedios />;
  if (opciones.tipo === 'ninguno') return sinMedios;
  if (opciones.tipo === 'solo') {
    return opciones.metodo === 'tarjeta' ? tarjeta : efectivo;
  }
  return (
    <>
      <SelectorMetodoPago
        metodo={metodo}
        onCambiar={onCambiarMetodo}
        deshabilitado={pantalla.tipo === 'procesando'}
      />
      {metodo === 'tarjeta' ? tarjeta : efectivo}
    </>
  );
}

/**
 * HU-009 (BL-453): la e-Factura se pide junto con los medios de pago (mismo
 * criterio que MetodosDePago): no mientras se confirma un pago ni mientras
 * espera al mozo, ni si el local no tiene medios de pago. HU-022 (BL-495): la
 * propina se elige en el mismo momento.
 */
function pideComprobante(
  pantalla: Pantalla,
  medios: MediosDisponibles | null,
): boolean {
  if (pantalla.tipo === 'verificando' || pantalla.tipo === 'esperandoEfectivo') {
    return false;
  }
  return medios !== null && opcionesDePago(medios).tipo !== 'ninguno';
}

const CLASE_SECCION =
  'bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 md:p-6 shadow-[0px_4px_20px_rgba(121,118,125,0.08)]';

/** BL-452: mientras se consulta qué medios ofrece el local. */
function CargandoMedios() {
  return (
    <section aria-live="polite" className={`${CLASE_SECCION} text-center`}>
      <p className="text-sm text-[#5a575e]">Cargando los medios de pago…</p>
    </section>
  );
}

/** BL-452: el local no ofrece ningún medio para este pedido. */
function SinMediosDePago({
  mensaje,
  llamarMozo,
}: {
  readonly mensaje: string;
  readonly llamarMozo: ReactNode;
}) {
  return (
    <section
      aria-labelledby="sin-medios"
      className={`${CLASE_SECCION} flex flex-col items-center gap-4 text-center`}
    >
      <h2 id="sin-medios" className="text-lg font-bold text-foreground">
        Pago en el local
      </h2>
      {/* <output> ya tiene el rol «status»: el lector de pantalla anuncia el
          aviso sin mover el foco (Sonar S6819: etiqueta nativa antes que ARIA). */}
      <output className="block text-sm text-[#5a575e] max-w-sm">
        {mensaje}
      </output>
      {llamarMozo}
    </section>
  );
}

function tituloDe(pantalla: Pantalla): string {
  switch (pantalla.tipo) {
    case 'esperandoEfectivo':
      return 'Esperando al mozo';
    case 'rechazado':
      return 'No se pudo completar el cobro';
    case 'verificando':
      return 'Estamos confirmando tu pago';
    case 'procesando':
      return 'Procesando tu pago…';
    default:
      return 'Pagá tu pedido';
  }
}

function bajadaDe(pantalla: Pantalla): string {
  switch (pantalla.tipo) {
    case 'esperandoEfectivo':
      return 'Tu pedido pasa a cocina cuando el mozo registre el cobro.';
    case 'rechazado':
      return 'No te preocupes: no se realizó ningún cargo y tu pedido sigue guardado.';
    case 'verificando':
      return 'Tu pedido está guardado. En cuanto se confirme el pago, pasa a cocina.';
    default:
      return 'Tu pedido pasa a cocina apenas se aprueba el pago.';
  }
}

function AvisoRechazo({ mensaje, total }: { readonly mensaje: string; readonly total: number }) {
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-3 rounded-[0.75rem] bg-[#FFDAD6]/60 border border-[#BA1A1A]/20 p-4"
    >
      <span className="shrink-0 grid place-items-center w-10 h-10 rounded-full bg-white text-[#BA1A1A]">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
          <path d="m3 3 18 18" />
        </svg>
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#93000a]">{mensaje}</p>
        <p className="mt-1 text-xs text-[#5a575e]">
          Monto pendiente: <span className="font-semibold text-foreground">{formatearPrecio(total)}</span>
        </p>
      </div>
    </div>
  );
}

function Verificando({
  mensaje,
  agotado,
  onReintentarConsulta,
}: {
  readonly mensaje: string;
  readonly agotado: boolean;
  readonly onReintentarConsulta: () => void;
}) {
  return (
    <section
      aria-live="polite"
      className="bg-white rounded-[1rem] border border-culinary-neutral/15 p-6 md:p-8 shadow-[0px_4px_20px_rgba(121,118,125,0.08)] flex flex-col items-center text-center gap-4"
    >
      <span className="grid place-items-center w-16 h-16 rounded-full bg-culinary-primary-container text-[#6e54ad]">
        <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={agotado ? '' : 'animate-pulse'}>
          <path d="M6 2h12" />
          <path d="M6 22h12" />
          <path d="M6 2v4a6 6 0 0 0 12 0V2" />
          <path d="M6 22v-4a6 6 0 0 1 12 0v4" />
        </svg>
      </span>
      {agotado ? (
        <>
          <p className="text-sm text-[#5a575e] max-w-sm">
            Todavía no tenemos la confirmación de Mercado Pago. Si el pago se
            aprobó, tu pedido pasa a cocina igual. No vuelvas a pagar: consultá
            de nuevo en un momento o pedile ayuda al personal.
          </p>
          <button
            type="button"
            onClick={onReintentarConsulta}
            className="px-5 py-2.5 bg-[#6e54ad]/10 text-[#6e54ad] font-semibold rounded-[0.5rem] hover:bg-[#6e54ad] hover:text-white transition-colors"
          >
            Volver a consultar
          </button>
        </>
      ) : (
        <p className="text-sm text-[#5a575e] max-w-sm">{mensaje}</p>
      )}
    </section>
  );
}

function ResumenPedido({
  lineas,
  consumo,
  propina,
  total,
  cantidadItems,
}: {
  readonly lineas: readonly LineaResumen[];
  readonly consumo: number;
  /** HU-022 (BL-495): null si no eligió propina. */
  readonly propina: { readonly etiqueta: string; readonly monto: number } | null;
  /** Lo que se cobra: el consumo más la propina. */
  readonly total: number;
  readonly cantidadItems: number;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <aside
      aria-labelledby="resumen-pedido"
      className="order-first lg:order-none bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 md:p-6 shadow-[0px_4px_20px_rgba(121,118,125,0.08)] lg:sticky lg:top-24"
    >
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-controls="resumen-lineas"
        className="w-full flex items-center justify-between gap-3 lg:pointer-events-none"
      >
        <span className="flex items-center gap-2">
          <h2 id="resumen-pedido" className="text-lg font-bold text-foreground">
            Tu pedido
          </h2>
          <span className="text-xs font-semibold text-[#6e54ad] bg-[#6e54ad]/10 px-2 py-0.5 rounded-full">
            {cantidadItems} {cantidadItems === 1 ? 'ítem' : 'ítems'}
          </span>
        </span>
        <span className="flex items-center gap-2 lg:hidden">
          <span className="font-bold text-[#6e54ad]">{formatearPrecio(total)}</span>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-[#5a575e] transition-transform ${abierto ? 'rotate-180' : ''}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      <div id="resumen-lineas" className={`${abierto ? 'block' : 'hidden'} lg:block`}>
        <ul className="mt-4 divide-y divide-culinary-neutral/15 border-t border-culinary-neutral/15">
          {lineas.map((l) => (
            <li key={l.itemCartaId} className="py-3 flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {l.cantidad}× {l.nombre}
                </p>
                {l.observacion && (
                  <p className="text-xs text-[#5a575e] italic line-clamp-2">“{l.observacion}”</p>
                )}
              </div>
              <span className="font-semibold text-foreground shrink-0">
                {formatearPrecio(l.precio * l.cantidad)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 pt-4 border-t border-culinary-neutral/15">
          {/* HU-022 (BL-495): con propina se separa el consumo (con IVA) de la propina. */}
          {propina && (
            <dl className="mb-3 flex flex-col gap-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[#5a575e]">Consumo (IVA incluido)</dt>
                <dd className="font-semibold text-foreground">{formatearPrecio(consumo)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#5a575e]">{propina.etiqueta}</dt>
                <dd className="font-semibold text-foreground">{formatearPrecio(propina.monto)}</dd>
              </div>
            </dl>
          )}
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#5a575e]">
                Total a pagar
              </p>
              {!propina && <p className="text-xs text-[#5a575e]">IVA incluido</p>}
            </div>
            <p className="text-3xl font-bold text-[#6e54ad]">{formatearPrecio(total)}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
