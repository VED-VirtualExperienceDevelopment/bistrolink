/**
 * BL-285 (ADR 0011): lo que la limpieza considera «del seed» o «de los E2E».
 *
 * Mantener alineado con `prisma/seed.ts` y con `e2e/support/`: si el seed o
 * un E2E cambian estos datos, la limpieza tiene que cambiar con ellos (es
 * una de las consecuencias del ADR 0011).
 */

/**
 * Mesas de salón del seed (tenant A). El seed las deja ABIERTAS (OCUPADA,
 * con sesión) a propósito: los QR de los E2E las usan para pedir sin pasar
 * por el mozo. La limpieza las deja igual.
 */
export const MESAS_DEL_SEED: readonly string[] = [
  '33333333-3333-3333-3333-333333333333', // mesa 1
  '33333333-3333-3333-3333-333333333334', // mesa 2 (llamado-mozo.spec.ts)
];

/**
 * Mesas temporales de los E2E (`e2e/support/mesa-temporal.ts`): número al
 * azar entre 50 y 99. Se eliminan si no tienen pedidos.
 */
export const NUMERO_MESA_TEMPORAL_MINIMO = 50;
export const NUMERO_MESA_TEMPORAL_MAXIMO = 99;

/** Zonas del plano creadas por `plano-salon.spec.ts` («Zona E2E 12345»). */
export const PREFIJO_ZONA_E2E = 'Zona E2E';

/**
 * Categorías de los E2E (`gestion-carta.spec.ts`: «E2E carta …»;
 * `stock.spec.ts`: «E2E stock …»). Todos sus ítems son de prueba.
 */
export const PREFIJO_CATEGORIA_E2E = 'E2E ';

/** Ítems de prueba fuera de esas categorías: «E2E» como palabra en el nombre. */
export const MARCA_ITEM_E2E = /\bE2E\b/;

/** Categorías de la carta del seed (tenant A): activas y visibles. */
export const CATEGORIAS_DEL_SEED: readonly string[] = [
  '44444444-4444-4444-4444-444444444444', // Platos principales
  '44444444-4444-4444-4444-444444444445', // Bebidas
];

/**
 * Ítems de la carta del seed con lo que define el seed. Agua con gas está
 * agotada a propósito (menu.spec.ts, menu-publico.spec.ts). El stock vuelve
 * a los valores por defecto de la columna: sin control de stock.
 */
export const ITEMS_DEL_SEED: readonly {
  id: string;
  categoriaId: string;
  precio: string;
  disponible: boolean;
}[] = [
  {
    id: '55555555-5555-5555-5555-555555555555', // Milanesa a la napolitana
    categoriaId: '44444444-4444-4444-4444-444444444444',
    precio: '590',
    disponible: true,
  },
  {
    id: '66666666-6666-6666-6666-666666666666', // Agua con gas
    categoriaId: '44444444-4444-4444-4444-444444444445',
    precio: '90',
    disponible: false,
  },
];

/** Stock de un ítem del seed (los valores por defecto de la columna). */
export const STOCK_DEL_SEED = {
  controlaStock: false,
  stockActual: 0,
  umbralAlerta: 5,
} as const;

/**
 * Configuración del establecimiento como la deja el seed (los valores por
 * defecto de las columnas de restaurante). El correo de privacidad no se
 * toca: el seed no lo define.
 *
 * HU-022 (BL-496): `propinaPreseleccionada` vuelve a apagada. Los E2E de
 * propina la prenden para probar el 10 % marcado y la limpieza la deja como
 * el seed, para que los otros E2E de pago no arranquen con propina.
 */
export const CONFIGURACION_DEL_SEED = {
  efectivoHabilitado: true,
  mercadoPagoHabilitado: true,
  posHabilitado: true,
  plexoHabilitado: false,
  handyHabilitado: false,
  propinasSugeridas: [] as number[],
  propinaPreseleccionada: false,
  cfeProveedor: 'SURTEC',
  limitePedidosEnPreparacion: null,
  umbralAlertaCola: 10,
  minutosPreparacionEstimados: 15,
} as const;

/** Razón social de los tenants de testing, como en el seed. */
export const RAZON_SOCIAL_DEL_SEED: Readonly<Record<string, string>> = {
  '11111111-1111-1111-1111-111111111111': 'Restaurante Testing A SRL',
  'b02579f2-2bb0-496b-abf2-33c494c93122': 'Restaurante Testing B SRL',
};

/**
 * Usuarios creados por los E2E (`gestion-usuarios.spec.ts`: «e2e-…»).
 * Ningún usuario del seed empieza así (admin-test, mozo-test, …).
 */
export const PREFIJO_USUARIO_E2E = 'e2e-';

/** Tenants de testing del seed (A y B): la limpieza de plataforma no los toca. */
export const TENANTS_DE_TESTING: readonly string[] = Object.keys(
  RAZON_SOCIAL_DEL_SEED,
);

/**
 * Establecimientos creados por los E2E de plataforma
 * (`e2e/support/plataforma.ts`: «E2E Plataforma 12345678 SRL»).
 */
export const PREFIJO_ESTABLECIMIENTO_E2E = 'E2E Plataforma ';

/** Motivo de suspensión cuando un establecimiento E2E tiene pedidos. */
export const MOTIVO_SUSPENSION_E2E =
  'Limpieza de datos de prueba (BL-285): establecimiento E2E con pedidos';
