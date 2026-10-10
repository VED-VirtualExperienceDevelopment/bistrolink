import { PrismaClient } from '@prisma/client';

// Datos de los dos tenants de TESTING (BL-197): local, CI y staging. Nunca
// producción, que nace vacía y recibe los establecimientos por HU-027.
//
//   A · «Restaurante Testing A» (11111111-…): todos los flujos (pedidos, KDS,
//       carta, layout, usuarios). Kit: admin-test, cocina-test, mozo-test,
//       comensal técnico y mesa virtual.
//   B · «Restaurante Testing B» (b02579f2-…): el «otro tenant» de los tests
//       de aislamiento. Kit: admin-b-test, cocina-b-test, comensal técnico y
//       mesa virtual.
//
// Los usuarios de Keycloak están en keycloak/test-users.json (con los mismos
// IDs fijos de acá); este seed crea las filas de la base. El tenant
// «Ejemplo» (554915d0-…) se fusionó en A y ya no se crea: en una base que lo
// tenga, se retira con scripts/retirar-tenant-ejemplo.sql.
//
// Idempotente: cada bloque es un upsert por id fijo, así que se puede correr
// las veces que haga falta (también contra staging, runbook
// migraciones-y-seed.md §5). Los «update» dejan las filas existentes en el
// estado de este archivo (nombres, categoría, imagen, tenant de admin-test);
// lo que no figura en un «update» no se toca.
//
// Nota RLS: las tablas dependientes del tenant tienen FORCE ROW LEVEL
// SECURITY. Antes de escribir en ellas se fija app.tenant_id, el mismo
// mecanismo que usa TenantPrismaService. El seed corre con DATABASE_URL (el
// dueño del esquema, superusuario en local y en staging), que además puede
// mover la fila de admin-test desde el tenant Ejemplo.

const prisma = new PrismaClient();

// ── Tenant A · «Restaurante Testing A» ───────────────────────────────────────
// Ojo: estos IDs no son UUID RFC 4122 válidos (el 4to grupo no empieza con
// 8, 9, a ni b); un @IsUUID() estricto los rechaza (ver TC-I-032).
const TENANT_A_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_A_ID = '22222222-2222-2222-2222-222222222222';
const MESA_A1_ID = '33333333-3333-3333-3333-333333333333';
const MESA_A2_ID = '33333333-3333-3333-3333-333333333334'; // e2e/llamado-mozo.spec.ts: mesa dedicada al test de rate limiting, para no compartir cupo con la mesa 1
const CATEGORIA_PLATOS_ID = '44444444-4444-4444-4444-444444444444';
const CATEGORIA_BEBIDAS_ID = '44444444-4444-4444-4444-444444444445';
const ITEM_MILANESA_ID = '55555555-5555-5555-5555-555555555555';
const ITEM_AGUA_ID = '66666666-6666-6666-6666-666666666666';

// ── Tenant B · «Restaurante Testing B» ───────────────────────────────────────
// Sus IDs sí son UUID v4 válidos: en los tests de aislamiento, un rechazo es
// por aislamiento y no por formato del id.
const TENANT_B_ID = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const RESTAURANTE_B_ID = 'a46faef3-7412-45ae-af80-3829cd27b990';

// ── Usuarios con fila en la base (IDs de keycloak/test-users.json) ─────────
// Igual que en el alta de HU-027 (BL-163), tienen fila el Admin y el Mozo;
// Cocina y el comensal técnico solo existen en Keycloak.
//
// admin-test es el ÚNICO Admin activo de A: es el fixture del test de RF.19
// (409 al desactivar o degradar al último Admin).
const ADMIN_TEST_KEYCLOAK_ID = 'c832535d-6122-449d-8b21-2371d8b7d9d0';
const MOZO_TEST_KEYCLOAK_ID = 'f552ec55-a5b5-44c3-a400-72ffc746c9b6';
const ADMIN_B_TEST_KEYCLOAK_ID = 'f3c4d5e6-7788-4990-aabb-ccddeeff0011';

// Usernames: los mismos de Keycloak, que salen de las variables TEST_* (el
// valor puede cambiar entre entornos; por ejemplo, el admin de B). En la base
// el username es solo informativo (se muestra en /admin/usuarios): el vínculo
// con Keycloak es keycloakId.
const ADMIN_TEST_USERNAME = process.env.TEST_ADMIN_USERNAME ?? 'admin-test';
const MOZO_TEST_USERNAME = process.env.TEST_MOZO_USERNAME ?? 'mozo-test';
const ADMIN_B_TEST_USERNAME =
  process.env.TEST_TENANT_B_USERNAME ?? 'admin-b-test';

// Mesa virtual de HU-003 (pedidos sin mesa física): una por restaurante,
// número 0. La API también la crea sola la primera vez que la necesita
// (PedidosService); el seed la deja creada para que el restaurante nazca con
// el mismo kit que un alta de HU-027.
const NUMERO_MESA_VIRTUAL = 0;

async function fijarTenant(tenantId: string) {
  // Session-level (no local a una transacción): el seed no corre dentro de una.
  await prisma.$executeRawUnsafe(
    `SELECT set_config('app.tenant_id', $1, false)`,
    tenantId,
  );
}

async function mesaVirtual(tenantId: string, restauranteId: string) {
  await prisma.mesa.upsert({
    where: {
      restauranteId_numero: { restauranteId, numero: NUMERO_MESA_VIRTUAL },
    },
    update: { esVirtual: true },
    create: {
      tenantId,
      restauranteId,
      numero: NUMERO_MESA_VIRTUAL,
      estado: 'LIBRE',
      esVirtual: true,
    },
  });
}

async function tenantA() {
  // Tenant: NO tiene RLS (es la raíz del aislamiento).
  await prisma.tenant.upsert({
    where: { id: TENANT_A_ID },
    update: { razonSocial: 'Restaurante Testing A SRL' },
    create: {
      id: TENANT_A_ID,
      razonSocial: 'Restaurante Testing A SRL',
      rut: '210000000019', // RUT ficticio, formato UY (12 dígitos)
      plan: 'BASICO',
    },
  });

  await fijarTenant(TENANT_A_ID);

  await prisma.restaurante.upsert({
    where: { id: RESTAURANTE_A_ID },
    update: { nombre: 'Restaurante Testing A' },
    create: {
      id: RESTAURANTE_A_ID,
      tenantId: TENANT_A_ID,
      nombre: 'Restaurante Testing A',
      direccion: 'Av. Italia 1234, Montevideo',
      timezone: 'America/Montevideo',
    },
  });

  for (const [id, numero] of [
    [MESA_A1_ID, 1],
    [MESA_A2_ID, 2],
  ] as const) {
    await prisma.mesa.upsert({
      where: { id },
      update: {},
      create: {
        id,
        tenantId: TENANT_A_ID,
        restauranteId: RESTAURANTE_A_ID,
        numero,
        estado: 'LIBRE',
      },
    });
  }
  await mesaVirtual(TENANT_A_ID, RESTAURANTE_A_ID);

  await prisma.categoriaCarta.upsert({
    where: { id: CATEGORIA_PLATOS_ID },
    update: {},
    create: {
      id: CATEGORIA_PLATOS_ID,
      tenantId: TENANT_A_ID,
      restauranteId: RESTAURANTE_A_ID,
      nombre: 'Platos principales',
      orden: 1,
    },
  });

  await prisma.categoriaCarta.upsert({
    where: { id: CATEGORIA_BEBIDAS_ID },
    update: {},
    create: {
      id: CATEGORIA_BEBIDAS_ID,
      tenantId: TENANT_A_ID,
      restauranteId: RESTAURANTE_A_ID,
      nombre: 'Bebidas',
      orden: 2,
    },
  });

  // Sin imagen: el seed no sube archivos a S3, así que no referencia ninguno
  // (antes apuntaba a items/milanesa.jpg, que no existía y daba 404 en cada
  // carga del menú). El flujo de imágenes se prueba subiendo una desde el
  // panel de administración. Los E2E buscan estos ítems por nombre
  // (e2e/support/ids.ts): no renombrarlos.
  await prisma.itemCarta.upsert({
    where: { id: ITEM_MILANESA_ID },
    update: { imagenKey: null },
    create: {
      id: ITEM_MILANESA_ID,
      tenantId: TENANT_A_ID,
      categoriaId: CATEGORIA_PLATOS_ID,
      nombre: 'Milanesa a la napolitana',
      descripcion: 'Con papas fritas y ensalada mixta',
      precio: 590,
      disponible: true,
      imagenKey: null,
    },
  });

  // Agotado a propósito: lo usan los E2E del bloqueo visual (menu.spec.ts,
  // menu-publico.spec.ts).
  await prisma.itemCarta.upsert({
    where: { id: ITEM_AGUA_ID },
    update: { categoriaId: CATEGORIA_BEBIDAS_ID },
    create: {
      id: ITEM_AGUA_ID,
      tenantId: TENANT_A_ID,
      categoriaId: CATEGORIA_BEBIDAS_ID,
      nombre: 'Agua con gas',
      descripcion: null,
      precio: 90,
      disponible: false,
      imagenKey: null,
    },
  });

  // where: { keycloakId }: es el dato estable, que no cambia si se recrea la
  // fila de Postgres.
  await prisma.usuario.upsert({
    where: { keycloakId: MOZO_TEST_KEYCLOAK_ID },
    update: { username: MOZO_TEST_USERNAME },
    create: {
      tenantId: TENANT_A_ID,
      restauranteId: RESTAURANTE_A_ID,
      keycloakId: MOZO_TEST_KEYCLOAK_ID,
      username: MOZO_TEST_USERNAME,
      email: 'mozo-test@bistrolink.dev.com',
      rol: 'MOZO',
      activo: true,
    },
  });

  // El update mueve a admin-test desde el tenant Ejemplo (bases anteriores a
  // BL-197) y lo deja activo y como ADMIN, que es lo que espera RF.19.
  await prisma.usuario.upsert({
    where: { keycloakId: ADMIN_TEST_KEYCLOAK_ID },
    update: {
      tenantId: TENANT_A_ID,
      restauranteId: RESTAURANTE_A_ID,
      username: ADMIN_TEST_USERNAME,
      rol: 'ADMIN',
      activo: true,
    },
    create: {
      tenantId: TENANT_A_ID,
      restauranteId: RESTAURANTE_A_ID,
      keycloakId: ADMIN_TEST_KEYCLOAK_ID,
      username: ADMIN_TEST_USERNAME,
      email: 'admin-test@bistrolink.dev.com',
      rol: 'ADMIN',
      activo: true,
    },
  });
}

async function tenantB() {
  await prisma.tenant.upsert({
    where: { id: TENANT_B_ID },
    update: { razonSocial: 'Restaurante Testing B SRL' },
    create: {
      id: TENANT_B_ID,
      razonSocial: 'Restaurante Testing B SRL',
      rut: '210000000001',
      plan: 'BASICO',
    },
  });

  await fijarTenant(TENANT_B_ID);

  await prisma.restaurante.upsert({
    where: { id: RESTAURANTE_B_ID },
    update: { nombre: 'Restaurante Testing B' },
    create: {
      id: RESTAURANTE_B_ID,
      tenantId: TENANT_B_ID,
      nombre: 'Restaurante Testing B',
      direccion: 'Otra dirección 456',
      timezone: 'America/Montevideo',
    },
  });

  await mesaVirtual(TENANT_B_ID, RESTAURANTE_B_ID);

  await prisma.usuario.upsert({
    where: { keycloakId: ADMIN_B_TEST_KEYCLOAK_ID },
    update: { username: ADMIN_B_TEST_USERNAME },
    create: {
      tenantId: TENANT_B_ID,
      restauranteId: RESTAURANTE_B_ID,
      keycloakId: ADMIN_B_TEST_KEYCLOAK_ID,
      username: ADMIN_B_TEST_USERNAME,
      email: 'admin-b-test@bistrolink.dev.com',
      rol: 'ADMIN',
      activo: true,
    },
  });
}

async function main() {
  await tenantA();
  await tenantB();

  console.log('✅ Seed aplicado (tenants de testing A y B). Probá:');
  console.log(`   GET /menu/${TENANT_A_ID}/${MESA_A1_ID}`);
  console.log(`   Tenant A: ${TENANT_A_ID}`);
  console.log(`   Tenant B: ${TENANT_B_ID}`);
}

main()
  .catch((e) => {
    console.error('❌ Error en el seed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
