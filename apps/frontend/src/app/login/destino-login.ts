/**
 * BL-598: a qué pantalla volver después del login.
 *
 * Los layouts protegidos (AdminShell, KdsShell, PlataformaShell) mandan a
 * /login?redirect=<ruta> cuando no hay sesión, para volver a la misma
 * pantalla después de ingresar. Solo se aceptan rutas de esta aplicación:
 * el valor tiene que empezar con "/" y, al resolverlo, no puede cambiar de
 * sitio. Cualquier otra cosa (una URL completa, "//...", "/\...", un valor
 * vacío o sin "/" inicial) vuelve al inicio.
 *
 * El inicio ('/') decide el destino según el rol del usuario (app/page.tsx).
 * Antes el valor por defecto era '/admin/usuarios', solo para ADMIN: un
 * MOZO o COCINA que entraba sin ?redirect= terminaba rebotado.
 *
 * Lógica pura, probada en test/unitarios/destino-login.spec.ts.
 */
export const DESTINO_POR_DEFECTO = "/";

// Origen ficticio solo para resolver la ruta: si al resolverla el origen
// cambia, el valor apuntaba a otro sitio.
const ORIGEN_DE_REFERENCIA = "https://bistrolink.invalid";

export function destinoDespuesDelLogin(
  valor: string | null | undefined,
): string {
  if (!valor || !valor.startsWith("/")) return DESTINO_POR_DEFECTO;
  try {
    const url = new URL(valor, ORIGEN_DE_REFERENCIA);
    if (url.origin !== ORIGEN_DE_REFERENCIA) return DESTINO_POR_DEFECTO;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DESTINO_POR_DEFECTO;
  }
}
