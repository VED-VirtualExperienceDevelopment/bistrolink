import type { Metadata } from 'next';
import {
  ACTUALIZACION_POLITICA,
  formatearRut,
  rutaApiPrivacidad,
  type DatosPrivacidad,
} from '@/components/privacidad/privacidad.utils';

export const metadata: Metadata = { title: 'Política de privacidad' };

interface PageProps {
  readonly searchParams: Promise<{
    readonly qr?: string;
    readonly t?: string;
    readonly r?: string;
  }>;
}

/**
 * Datos del establecimiento, o null si no vinieron parámetros o la API no
 * los encontró: la política se muestra igual, sin el bloque del local.
 */
async function obtenerDatos(parametros: {
  qr?: string;
  t?: string;
  r?: string;
}): Promise<DatosPrivacidad | null> {
  const ruta = rutaApiPrivacidad(parametros);
  if (!ruta) return null;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  try {
    const res = await fetch(`${apiUrl}${ruta}`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as DatosPrivacidad) : null;
  } catch {
    return null;
  }
}

const H2 = 'mt-8 text-xl font-bold text-foreground';
const P = 'mt-2 text-[15px] leading-relaxed text-[#3d3a42]';
const LI = 'text-[15px] leading-relaxed text-[#3d3a42]';

/**
 * HU-036 (BL-206): política de privacidad (Ley 18.331 y Decreto 414/009).
 * El responsable de los datos es el establecimiento; BistroLink es la
 * plataforma que los trata por su cuenta. El texto describe lo que el
 * sistema hace hoy: si cambia, se actualiza junto con la funcionalidad
 * (HU-009, BL-453: e-Factura con RUT y razón social).
 */
export default async function PoliticaPrivacidadPage({ searchParams }: PageProps) {
  const datos = await obtenerDatos(await searchParams);
  const local = datos?.establecimiento;

  return (
    <main className="min-h-screen bg-culinary-background px-4 py-10">
      <article className="mx-auto max-w-[720px] rounded-[1rem] border border-culinary-neutral/15 bg-white p-6 md:p-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-[#6e54ad]">BistroLink</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">
          Política de privacidad
        </h1>
        <p className="mt-1 text-sm text-[#5a575e]">Última actualización: {ACTUALIZACION_POLITICA}</p>

        <h2 className={H2}>Quién es responsable de tus datos</h2>
        {local ? (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-[0.75rem] bg-culinary-background px-4 py-3 text-[15px]">
            <dt className="text-[#5a575e]">Local</dt>
            <dd className="font-semibold text-foreground">{local.nombre}</dd>
            <dt className="text-[#5a575e]">Razón social</dt>
            <dd className="text-foreground">{local.razonSocial}</dd>
            <dt className="text-[#5a575e]">RUT</dt>
            <dd className="text-foreground">{formatearRut(local.rut)}</dd>
            <dt className="text-[#5a575e]">Dirección</dt>
            <dd className="text-foreground">{local.direccion}</dd>
          </dl>
        ) : (
          <p className={P}>
            El responsable es el local donde hacés el pedido: su razón social y
            su RUT figuran en el comprobante fiscal (e-Ticket o e-Factura) de
            tu compra.
          </p>
        )}
        <p className={P}>
          BistroLink es la plataforma que el local usa para recibir pedidos y
          cobrarlos, y trata los datos por cuenta del local.
        </p>

        <h2 className={H2}>Qué datos usamos y para qué</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          <li className={LI}>
            <strong>Tu pedido:</strong> lo que pedís, las notas que escribís,
            la mesa y la hora. Sirve para prepararlo y cobrarlo. No te pedimos
            nombre ni registro. Te pedimos que no escribas datos personales en
            las notas.
          </li>
          <li className={LI}>
            <strong>Pago con tarjeta:</strong> los datos de la tarjeta se
            cargan en campos de Mercado Pago y BistroLink no los ve. Tu correo
            y tu documento se envían a Mercado Pago para procesar el pago y
            mandarte el comprobante; BistroLink no los guarda. Del pago se
            guardan el monto y el resultado.
          </li>
          <li className={LI}>
            <strong>Comprobante fiscal:</strong> el e-Ticket se emite a
            consumidor final, sin tus datos personales, y se conserva 5 años
            porque lo exige la normativa fiscal (DGI).
          </li>
          <li className={LI}>
            <strong>e-Factura:</strong> si la pedís, ingresás el RUT y la razón
            social. Solo se guardan si aceptás este aviso, junto al pedido, para
            emitir la e-Factura a ese nombre. Sin aceptarlo no se emite la
            e-Factura: podés borrar los datos o desmarcarla y recibís un
            e-Ticket. Los datos figuran en la e-Factura, que se conserva 5 años
            por la normativa fiscal. Si pedís que se eliminen, el local los
            anonimiza en sus registros; la e-Factura ya emitida no cambia.
          </li>
          <li className={LI}>
            <strong>Tu navegador:</strong> mientras pagás, la pestaña guarda el
            pedido en curso para que puedas retomarlo si recargás la página. No
            guarda datos de la tarjeta y se borra al cerrar la pestaña.
          </li>
        </ul>

        <h2 className={H2}>Con quién se comparten</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          <li className={LI}>Mercado Pago, para procesar los pagos con tarjeta.</li>
          <li className={LI}>
            El proveedor de facturación electrónica habilitado por la DGI, para
            emitir el comprobante (y, si pedís e-Factura, con tu RUT y tu razón
            social, que también recibe la DGI).
          </li>
          <li className={LI}>
            Los proveedores de infraestructura en la nube donde funciona
            BistroLink, que pueden estar fuera de Uruguay.
          </li>
        </ul>
        <p className={P}>No vendemos ni cedemos tus datos para publicidad.</p>

        <h2 className={H2}>Cómo los cuidamos</h2>
        <p className={P}>
          Las conexiones van cifradas (HTTPS), los datos de cada local están
          separados de los de los demás y los registros técnicos del sistema no
          guardan datos personales en texto plano.
        </p>

        <h2 className={H2}>Tus derechos</h2>
        <p className={P}>
          Podés pedir acceso a tus datos, que se corrijan, se actualicen o se
          eliminen (Ley N° 18.331, de protección de datos personales). Los
          comprobantes fiscales se conservan igual durante el plazo que exige
          la DGI.
        </p>
        <p className={P}>
          {local?.emailPrivacidad ? (
            <>
              Escribí a{' '}
              <a
                href={`mailto:${local.emailPrivacidad}`}
                className="font-semibold text-[#6e54ad] underline"
              >
                {local.emailPrivacidad}
              </a>{' '}
              indicando qué querés pedir.
            </>
          ) : (
            <>Pedíselo al personal del local o escribile por los canales de contacto que tenga publicados.</>
          )}
        </p>
        <p className={P}>
          Si no te responden en el plazo legal, podés reclamar ante la Unidad
          Reguladora y de Control de Datos Personales (URCDP).
        </p>
      </article>
    </main>
  );
}
