/**
 * HU-051 (BL-563): tarjetas que acepta la cuenta de Mercado Pago, para el
 * sello de pago seguro. Lógica pura (sin red): el servicio pide
 * GET /v1/payment_methods y acá se arma la lista que ve el comensal.
 */

/** Lo que importa de cada medio de pago de Mercado Pago. */
export interface MedioDePagoMp {
  id?: string;
  name?: string;
  payment_type_id?: string;
  status?: string;
  secure_thumbnail?: string;
}

/** Una marca de tarjeta aceptada, como la recibe el navegador. */
export interface TarjetaAceptada {
  /** La marca sin el prefijo de débito: «visa» para visa y debvisa. */
  id: string;
  nombre: string;
  /** Imagen de Mercado Pago por HTTPS, o null (se muestra el nombre). */
  imagen: string | null;
  credito: boolean;
  debito: boolean;
}

/**
 * Las marcas más usadas en Uruguay primero; el resto, por nombre. Es solo
 * el orden en pantalla: qué marcas aparecen lo decide Mercado Pago.
 */
export const ORDEN_MARCAS = [
  'visa',
  'master',
  'oca',
  'amex',
  'diners',
  'creditel',
  'lider',
  'cabal',
  'anda',
] as const;

const TIPOS_TARJETA = new Set(['credit_card', 'debit_card']);

/** «debvisa» → «visa», «debmaster» → «master». */
export function marcaDelMedio(id: string): string {
  return id.toLowerCase().replace(/^deb(?=.)/, '');
}

/** «Visa Débito» → «Visa»; el nombre de la marca sin el tipo. */
function nombreDeMarca(nombre: string): string {
  return nombre
    .split(' ')
    .filter((palabra) => palabra !== '' && !esPalabraDebito(palabra))
    .join(' ');
}

function esPalabraDebito(palabra: string): boolean {
  const p = palabra.toLowerCase();
  return p === 'débito' || p === 'debito';
}

function imagenSegura(url: string | undefined): string | null {
  return url?.startsWith('https://') ? url : null;
}

function posicion(id: string): number {
  const i = (ORDEN_MARCAS as readonly string[]).indexOf(id);
  return i === -1 ? ORDEN_MARCAS.length : i;
}

/**
 * Tarjetas de crédito y débito activas, una por marca (Visa crédito y Visa
 * débito son una sola «Visa», con las dos marcas de tipo), en orden.
 * Lo que no tiene la forma esperada se ignora.
 */
export function tarjetasAceptadas(
  medios: readonly MedioDePagoMp[],
): TarjetaAceptada[] {
  const porMarca = new Map<string, TarjetaAceptada>();
  for (const medio of medios) {
    if (
      typeof medio?.id !== 'string' ||
      medio.id === '' ||
      typeof medio.name !== 'string' ||
      !TIPOS_TARJETA.has(medio.payment_type_id ?? '') ||
      medio.status !== 'active'
    ) {
      continue;
    }
    const id = marcaDelMedio(medio.id);
    const esCredito = medio.payment_type_id === 'credit_card';
    const actual = porMarca.get(id);
    if (!actual) {
      porMarca.set(id, {
        id,
        nombre: nombreDeMarca(medio.name),
        imagen: imagenSegura(medio.secure_thumbnail),
        credito: esCredito,
        debito: !esCredito,
      });
      continue;
    }
    // La de crédito manda el nombre y la imagen; la otra solo suma el tipo.
    porMarca.set(id, {
      ...actual,
      ...(esCredito && {
        nombre: nombreDeMarca(medio.name),
        imagen: imagenSegura(medio.secure_thumbnail) ?? actual.imagen,
      }),
      credito: actual.credito || esCredito,
      debito: actual.debito || !esCredito,
    });
  }
  return [...porMarca.values()].sort(
    (a, b) =>
      posicion(a.id) - posicion(b.id) || a.nombre.localeCompare(b.nombre, 'es'),
  );
}
