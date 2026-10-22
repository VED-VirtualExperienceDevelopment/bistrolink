'use client';

import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  CardNumber,
  createCardToken,
  ExpirationDate,
  getPaymentMethods,
  initMercadoPago,
  SecurityCode,
} from '@mercadopago/sdk-react';
import {
  documentoParaMercadoPago,
  errorDocumento,
  errorEmail,
  errorTitular,
  etiquetaMarca,
  formatearPrecio,
  tipoTarjeta,
  type TipoDocumento,
} from './pago.utils';

/** Lo que necesita POST /pedidos/:id/pagos en `datosPasarela` (MercadoPagoGateway). */
export interface DatosTarjeta {
  token: string;
  paymentMethodId: string;
  paymentMethodType: 'credit_card' | 'debit_card';
  payerEmail: string;
  installments: 1;
}

interface FormularioTarjetaProps {
  readonly monto: number;
  readonly procesando: boolean;
  readonly textoBoton?: string;
  readonly onPagar: (datos: DatosTarjeta) => void;
}

const PUBLIC_KEY = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY;

/** Si el número de tarjeta no aparece en este tiempo, se avisa (SDK bloqueado o sin señal). */
const ESPERA_CAMPOS_MS = 12_000;

// Una sola vez por página: el SDK guarda la instancia en un singleton.
let sdkIniciado = false;
function iniciarSdk(): boolean {
  if (!PUBLIC_KEY) return false;
  if (!sdkIniciado) {
    initMercadoPago(PUBLIC_KEY, { locale: 'es-UY' });
    sdkIniciado = true;
  }
  return true;
}

// Estilo del texto DENTRO de los iframes de Mercado Pago (no heredan el CSS
// de la página): mismo tamaño y colores que los inputs propios. La altura es
// la del recuadro (h-12 = 48px menos 2px de borde arriba y abajo), para que
// el texto quede centrado; el tamaño del iframe en sí lo fija globals.css.
const ESTILO_CAMPO_SEGURO = {
  height: '44px',
  // El relleno va DENTRO del iframe: así el iframe cubre todo el recuadro y
  // un toque en cualquier parte del recuadro enfoca el campo.
  padding: '0 16px',
  fontSize: '16px',
  color: '#1C1B20',
  placeholderColor: '#79767D',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

type CampoSeguro = 'cardNumber' | 'expirationDate' | 'securityCode';

// Recuadro de un campo de Mercado Pago: overflow-hidden para que el iframe
// nunca se salga y tape otros campos (sin eso, el clic caía en otro iframe).
// !px-0: el px-4 de CLASE_INPUT_BASE ganaba y dejaba una franja muerta a la
// izquierda donde el toque no llegaba al iframe.
const CLASE_CAJA_SEGURA = 'overflow-hidden !px-0';

const CLASE_INPUT_BASE =
  'w-full h-12 px-4 rounded-[0.75rem] text-base outline-none transition-all duration-200 placeholder:text-culinary-neutral bg-culinary-background';
const CLASE_BORDE_OK =
  'border-2 border-culinary-neutral/30 focus-within:border-[#6e54ad] focus-within:ring-2 focus-within:ring-[#6e54ad]/20';
const CLASE_BORDE_ERROR = 'border-2 border-[#BA1A1A] bg-[#FFDAD6]/40';

/**
 * BL-311 (HU-007): datos de la tarjeta con Secure Fields de Mercado Pago.
 *
 * Número, vencimiento y CVV son iframes de Mercado Pago montados dentro de
 * nuestro diseño: esos datos nunca pasan por el código de BistroLink
 * (PCI-DSS delegado al proveedor, RNF.03). Lo que sale de acá es un token de
 * un solo uso que el backend usa para cobrar.
 *
 * El titular, el documento y el correo son campos propios: Mercado Pago los
 * pide para tokenizar y para el pagador de la order.
 */
export function FormularioTarjeta({
  monto,
  procesando,
  textoBoton,
  onPagar,
}: FormularioTarjetaProps) {
  const id = useId();
  const [sdkDisponible, setSdkDisponible] = useState(true);
  const [marca, setMarca] = useState<string | null>(null);
  const [metodo, setMetodo] = useState<{ id: string; tipo: string } | null>(null);
  const [foco, setFoco] = useState<CampoSeguro | null>(null);
  const [invalidos, setInvalidos] = useState<Partial<Record<CampoSeguro, boolean>>>({});

  const [titular, setTitular] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState<TipoDocumento>('CI');
  const [documento, setDocumento] = useState('');
  const [email, setEmail] = useState('');
  const [intentoEnviar, setIntentoEnviar] = useState(false);
  const [errorTarjeta, setErrorTarjeta] = useState<string | null>(null);
  const [tokenizando, setTokenizando] = useState(false);
  const [camposListos, setCamposListos] = useState(false);
  const [camposDemorados, setCamposDemorados] = useState(false);

  useEffect(() => {
    setSdkDisponible(iniciarSdk());
  }, []);

  // El SDK se descarga de Mercado Pago: un bloqueador de anuncios o mala
  // señal lo pueden frenar y los campos quedarían vacíos sin explicación.
  useEffect(() => {
    if (camposListos) return;
    const timer = setTimeout(() => setCamposDemorados(true), ESPERA_CAMPOS_MS);
    return () => clearTimeout(timer);
  }, [camposListos]);

  const errores = {
    titular: errorTitular(titular),
    documento: errorDocumento(tipoDocumento, documento),
    email: errorEmail(email),
  };
  const mostrar = (campo: keyof typeof errores) =>
    intentoEnviar ? errores[campo] : null;

  // Los campos de Mercado Pago se crean UNA sola vez (ver más abajo): sus
  // handlers solo usan setters de estado, que React garantiza estables.
  const camposSeguros = useMemo(() => {
    const alCambiarValidez =
      (campo: CampoSeguro) =>
      ({ errorMessages }: { errorMessages: unknown[] }) =>
        setInvalidos((prev) => ({ ...prev, [campo]: errorMessages.length > 0 }));

    const alCambiarBin = async ({ bin }: { bin?: string }) => {
      if (!bin) {
        setMarca(null);
        setMetodo(null);
        return;
      }
      try {
        const respuesta = await getPaymentMethods({ bin });
        const resultado = respuesta?.results?.[0];
        if (resultado) {
          setMarca(etiquetaMarca(resultado.name));
          setMetodo({ id: resultado.id, tipo: resultado.payment_type_id });
        }
      } catch {
        // Sin marca no se bloquea nada: el backend valida al cobrar.
      }
    };

    const alSalir = () => setFoco(null);

    // BL-311: CardNumber, ExpirationDate y SecurityCode del SDK desmontan y
    // vuelven a montar su iframe cada vez que cambia cualquiera de sus props
    // (las tienen como dependencias de un useEffect). Con handlers nuevos en
    // cada render, el foco o la marca de la tarjeta disparaban un re-render
    // y el comensal veía cómo se borraba lo que escribía. Por eso los
    // elementos se memorizan: React no los vuelve a renderizar.
    return {
      numero: (
        <CardNumber
          placeholder="0000 0000 0000 0000"
          style={ESTILO_CAMPO_SEGURO}
          onBinChange={alCambiarBin}
          onReady={() => setCamposListos(true)}
          onFocus={() => setFoco('cardNumber')}
          onBlur={alSalir}
          onValidityChange={alCambiarValidez('cardNumber')}
        />
      ),
      vencimiento: (
        <ExpirationDate
          placeholder="MM/AA"
          mode="short"
          style={ESTILO_CAMPO_SEGURO}
          onFocus={() => setFoco('expirationDate')}
          onBlur={alSalir}
          onValidityChange={alCambiarValidez('expirationDate')}
        />
      ),
      cvv: (
        <SecurityCode
          placeholder="CVV"
          style={ESTILO_CAMPO_SEGURO}
          onFocus={() => setFoco('securityCode')}
          onBlur={alSalir}
          onValidityChange={alCambiarValidez('securityCode')}
        />
      ),
    };
  }, []);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setIntentoEnviar(true);
    setErrorTarjeta(null);
    if (errores.titular || errores.documento || errores.email) return;
    if (!metodo) {
      setErrorTarjeta('Revisá el número de la tarjeta.');
      return;
    }

    setTokenizando(true);
    try {
      const token = await createCardToken({
        cardholderName: titular.trim(),
        ...documentoParaMercadoPago(tipoDocumento, documento),
      });
      if (!token?.id) throw new Error('sin token');
      onPagar({
        token: token.id,
        paymentMethodId: metodo.id,
        paymentMethodType: tipoTarjeta(metodo.tipo),
        payerEmail: email.trim(),
        installments: 1,
      });
    } catch {
      setErrorTarjeta(
        'Revisá los datos de la tarjeta (número, vencimiento y código de seguridad).',
      );
    } finally {
      setTokenizando(false);
    }
  }

  const ocupado = procesando || tokenizando;

  if (!sdkDisponible) {
    return (
      <p role="alert" className="p-4 rounded-[0.75rem] bg-[#FFDAD6] text-[#93000a] text-sm font-medium">
        El pago con tarjeta no está disponible en este momento. Pedile ayuda al
        personal del local.
      </p>
    );
  }

  const claseCampoSeguro = (campo: CampoSeguro) =>
    `${CLASE_INPUT_BASE} ${CLASE_CAJA_SEGURA} flex items-stretch ${
      invalidos[campo] ? CLASE_BORDE_ERROR : CLASE_BORDE_OK
    } ${foco === campo ? 'border-[#6e54ad] ring-2 ring-[#6e54ad]/20' : ''}`;

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-5" aria-busy={ocupado}>
      {camposDemorados && !camposListos && (
        <p role="alert" className="p-3 rounded-lg bg-[#FFDAD6]/60 text-[#93000a] text-sm font-medium">
          No pudimos cargar el formulario de la tarjeta. Revisá tu conexión,
          desactivá el bloqueador de anuncios si tenés uno y recargá la página.
        </p>
      )}
      <Campo etiqueta="Número de tarjeta" htmlFor={`${id}-numero`}>
        <div className={`${claseCampoSeguro('cardNumber')} gap-3 !pr-3`}>
          <div id={`${id}-numero`} className="campo-seguro flex-1 min-w-0">
            {camposSeguros.numero}
          </div>
          {marca && (
            <span className="self-center shrink-0 px-2 py-0.5 rounded-md bg-[#6e54ad]/10 text-[#6e54ad] text-xs font-bold tracking-wide">
              {marca}
            </span>
          )}
        </div>
      </Campo>

      <div className="grid grid-cols-2 gap-4">
        <Campo etiqueta="Vencimiento" htmlFor={`${id}-vence`}>
          <div className={claseCampoSeguro('expirationDate')}>
            <div id={`${id}-vence`} className="campo-seguro flex-1 min-w-0">
              {camposSeguros.vencimiento}
            </div>
          </div>
        </Campo>
        <Campo etiqueta="Código de seguridad" htmlFor={`${id}-cvv`}>
          <div className={claseCampoSeguro('securityCode')}>
            <div id={`${id}-cvv`} className="campo-seguro flex-1 min-w-0">
              {camposSeguros.cvv}
            </div>
          </div>
        </Campo>
      </div>

      <Campo etiqueta="Nombre en la tarjeta" htmlFor={`${id}-titular`} error={mostrar('titular')}>
        <input
          id={`${id}-titular`}
          value={titular}
          onChange={(e) => setTitular(e.target.value)}
          autoComplete="cc-name"
          autoCapitalize="characters"
          placeholder="Como figura en la tarjeta"
          aria-invalid={!!mostrar('titular')}
          className={`${CLASE_INPUT_BASE} uppercase ${mostrar('titular') ? CLASE_BORDE_ERROR : CLASE_BORDE_OK}`}
        />
      </Campo>

      <Campo etiqueta="Documento del titular" htmlFor={`${id}-documento`} error={mostrar('documento')}>
        <div className="flex gap-3">
          <select
            aria-label="Tipo de documento"
            value={tipoDocumento}
            onChange={(e) => setTipoDocumento(e.target.value as TipoDocumento)}
            className={`${CLASE_INPUT_BASE} ${CLASE_BORDE_OK} !w-auto shrink-0 pr-8`}
          >
            <option value="CI">Cédula</option>
            <option value="OTRO">Otro</option>
          </select>
          <input
            id={`${id}-documento`}
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
            inputMode={tipoDocumento === 'CI' ? 'numeric' : 'text'}
            placeholder={tipoDocumento === 'CI' ? '1.234.567-2' : 'Pasaporte u otro'}
            aria-invalid={!!mostrar('documento')}
            className={`${CLASE_INPUT_BASE} ${mostrar('documento') ? CLASE_BORDE_ERROR : CLASE_BORDE_OK}`}
          />
        </div>
      </Campo>

      <Campo
        etiqueta="Correo para tu comprobante"
        htmlFor={`${id}-email`}
        error={mostrar('email')}
      >
        <input
          id={`${id}-email`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
          placeholder="tu@correo.com"
          aria-invalid={!!mostrar('email')}
          className={`${CLASE_INPUT_BASE} ${mostrar('email') ? CLASE_BORDE_ERROR : CLASE_BORDE_OK}`}
        />
      </Campo>

      <div className="flex items-center justify-between rounded-[0.75rem] bg-culinary-primary-container px-4 py-3 text-sm">
        <span className="text-[#5a575e]">Plan de pago</span>
        <span className="font-semibold text-foreground">
          1 pago de {formatearPrecio(monto)}
        </span>
      </div>

      {errorTarjeta && (
        <p role="alert" className="p-3 rounded-lg bg-red-50 text-red-700 text-sm font-medium">
          {errorTarjeta}
        </p>
      )}

      <button
        type="submit"
        disabled={ocupado}
        className="w-full flex items-center justify-center gap-2 px-4 py-3.5 bg-[#6e54ad] text-white font-bold rounded-[0.75rem] hover:bg-[#5b468f] focus:outline-none focus:ring-4 focus:ring-[#6e54ad]/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed text-lg shadow-[0px_4px_20px_rgba(121,118,125,0.15)]"
      >
        {ocupado ? (
          <>
            <Spinner /> Procesando tu pago…
          </>
        ) : (
          <>
            <IconoCandado /> {textoBoton ?? `Pagar ${formatearPrecio(monto)}`}
          </>
        )}
      </button>

      <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-[#5a575e]">
        <li className="flex items-center gap-1">
          <IconoEscudo /> Pago procesado por Mercado Pago
        </li>
        <li>Tus datos de tarjeta no pasan por BistroLink</li>
      </ul>
    </form>
  );
}

function Campo({
  etiqueta,
  htmlFor,
  error,
  children,
}: {
  readonly etiqueta: string;
  readonly htmlFor: string;
  readonly error?: string | null;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {etiqueta}
      </label>
      {children}
      {error && (
        <p className="text-xs font-semibold text-[#BA1A1A]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg aria-hidden="true" className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function IconoCandado() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function IconoEscudo() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
