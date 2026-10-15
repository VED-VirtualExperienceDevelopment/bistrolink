/**
 * IDs fijos que carga apps/backend/prisma/seed.ts. Centralizados acá
 * (BL-181) porque antes cada spec los redeclaraba por su cuenta — si el
 * seed cambia estos UUIDs, alcanza con actualizarlos en un solo lugar.
 */
export const TENANT_ID = "11111111-1111-1111-1111-111111111111";
export const RESTAURANTE_ID = "22222222-2222-2222-2222-222222222222";
export const MESA_ID = "33333333-3333-3333-3333-333333333333";

// Mesa aparte, con su propio cupo de throttling — no comparte rate-limit
// con MESA_ID (ver llamado-mozo.spec.ts, BL-69).
export const MESA_ID_RATE_LIMIT = "33333333-3333-3333-3333-333333333334";

// Item conocido del seed, usado en varios specs (menu, pedidos,
// observaciones-kds) para no depender de que cada uno declare el mismo
// nombre por separado.
export const ITEM_DISPONIBLE = "Milanesa a la napolitana";
export const ITEM_NO_DISPONIBLE = "Agua con gas";

// HU-034 (BL-204): el menú de mesa ya no tiene una ruta fija por ids; se
// abre desde el QR. La ruta sale del fixture `qrMesas` (support/auth.ts):
// qrMesas.ruta(MESA_ID). Esta es la ruta VIEJA por ids, que ahora solo
// muestra el aviso de "enlace viejo".
export const ENLACE_VIEJO_MESA_PATH = `/m/${TENANT_ID}/${MESA_ID}`;
export const MENU_URL_PATH = `/m/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`;
export const KDS_PATH = "/kds";
