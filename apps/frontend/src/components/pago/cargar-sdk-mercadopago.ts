/**
 * BL-311: carga del script de Mercado Pago (MercadoPago.js v2) con reintento.
 *
 * El SDK de React (@mercadopago/sdk-react) carga este mismo script por su
 * cuenta, pero si falla (sin señal, bloqueador de anuncios, red que lo
 * filtra) rechaza una promesa que nadie captura: en desarrollo Next lo
 * muestra como «Runtime Error» y en producción los campos quedan vacíos.
 * Además guarda ese rechazo para siempre y no se puede reintentar sin
 * recargar la página (y recargar pierde el carrito).
 *
 * Por eso el formulario lo carga primero con esta función: si sale bien,
 * window.MercadoPago ya existe y el SDK de React lo reusa; si sale mal, se
 * muestra un aviso con «Reintentar».
 */
const URL_SDK = 'https://sdk.mercadopago.com/js/v2';

let enCurso: Promise<void> | null = null;

function sdkPresente(): boolean {
  return typeof window !== 'undefined' && 'MercadoPago' in window;
}

export function cargarSdkMercadoPago(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Solo en el navegador'));
  }
  if (sdkPresente()) return Promise.resolve();
  if (enCurso) return enCurso;

  enCurso = new Promise<void>((resolve, reject) => {
    // Un intento anterior que falló deja su <script> roto: se saca para que
    // el nuevo intento lo descargue de cero.
    document.querySelectorAll(`script[src^="${URL_SDK}"]`).forEach((s) => s.remove());

    const script = document.createElement('script');
    script.src = URL_SDK;
    script.async = true;
    script.onload = () =>
      sdkPresente() ? resolve() : reject(new Error('MercadoPago.js no quedó disponible'));
    script.onerror = () => reject(new Error('No se pudo descargar MercadoPago.js'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    enCurso = null; // permite reintentar
    throw error;
  });

  return enCurso;
}
