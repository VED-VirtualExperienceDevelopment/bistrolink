import { PrismaClient } from '@prisma/client';

// Seed mínimo para probar HU-001 (GET /menu/:tenantId/:mesaId) a mano con
// curl/Postman. UUIDs fijos (no random) para poder pegarlos directo en la URL
// sin tener que ir a buscarlos en la base cada vez.
//
// Nota RLS: las tablas dependientes del tenant (restaurante, mesa,
// categoria_carta, item_carta) tienen FORCE ROW LEVEL SECURITY. Por eso,
// antes de cualquier INSERT en esas tablas, hay que fijar la variable de
// sesión app.tenant_id — el mismo mecanismo que usa TenantPrismaService en
// tiempo de ejecución (ver src/prisma/tenant-prisma.service.ts), pero acá lo
// hacemos a mano porque el seed corre fuera de un request HTTP.

const prisma = new PrismaClient();

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const CATEGORIA_ID = '44444444-4444-4444-4444-444444444444';
const ITEM_CON_IMAGEN_ID = '55555555-5555-5555-5555-555555555555';
const ITEM_SIN_IMAGEN_ID = '66666666-6666-6666-6666-666666666666';

// Mozo del tenant Demo: fixture de HU-004 (test/integration/kds.e2e-spec.ts).
// Vive en el tenant Demo (no en el tenant Ejemplo, donde están admin-test/
// cocina-test) porque es el único tenant con mesa/restaurante/ítem de carta
// ya cargados más abajo — necesarios para crear un pedido real en esos tests.
//
// El id de Keycloak tiene que coincidir EXACTO con el "id" del usuario
// mozo-test en realm-export.json — mismo mecanismo que ADMIN_EJEMPLO_KEYCLOAK_ID
// más abajo. Este UUID es el que ya existe hoy en el Keycloak local (creado
// a mano durante el desarrollo de HU-004, antes de que este seed lo tuviera
// declarado formalmente).
const MOZO_DEMO_KEYCLOAK_ID = 'f552ec55-a5b5-44c3-a400-72ffc746c9b6';

// Tenants "Ejemplo" y "B": no nacieron del seed original, sino que se crearon
// a mano en Prisma Studio durante el desarrollo de HU-013 y ya quedaron
// hardcodeados como fixtures en usuarios.service.spec.ts y en los e2e
// (usuarios.e2e-spec.ts, tenant-isolation.e2e-spec.ts). Los IDs de acá deben
// coincidir exactamente con esos archivos de test — si cambian, hay que
// actualizar ambos lados.
const TENANT_EJEMPLO_ID = '554915d0-f7ed-4053-b841-56479df29fd9';
const RESTAURANTE_EJEMPLO_ID = '87152395-a721-4651-99b8-f21075d1d8ae';

const TENANT_B_ID = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const RESTAURANTE_B_ID = 'a46faef3-7412-45ae-af80-3829cd27b990';

// Admin real del tenant Ejemplo: creado a mano en la consola de Keycloak
// (no vía POST /usuarios, porque ese endpoint exige ya tener un Admin
// autenticado — problema de huevo/gallina para el primer Admin de cada
// tenant). Tiene rol ADMIN asignado, está Enabled, y coincide con el
// username por defecto que usan los e2e (TEST_ADMIN_USERNAME ?? 'admin-test').
// Es, a la fecha de este seed, el ÚNICO Admin activo del tenant Ejemplo —
// por eso sirve como fixture para el test de RF.19 (rechazo 409 al intentar
// desactivar/degradar al último Admin).
const ADMIN_EJEMPLO_KEYCLOAK_ID = 'c832535d-6122-449d-8b21-2371d8b7d9d0';

async function main() {
  // 1. Tenant: NO tiene RLS (es la raíz del aislamiento), se puede insertar
  //    sin fijar ninguna variable de sesión antes.
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: {
      id: TENANT_ID,
      razonSocial: 'Restaurante Demo SRL',
      rut: '210000000019', // RUT ficticio, formato UY (12 dígitos)
      plan: 'BASICO',
    },
  });

  // 2. A partir de acá, todo lo que insertemos pertenece a este tenant, así
  //    que fijamos app.tenant_id para el resto del script (session-level,
  //    no local a una transacción, porque el seed no corre dentro de una).
  await prisma.$executeRawUnsafe(
    `SELECT set_config('app.tenant_id', $1, false)`,
    TENANT_ID,
  );

  await prisma.restaurante.upsert({
    where: { id: RESTAURANTE_ID },
    update: {},
    create: {
      id: RESTAURANTE_ID,
      tenantId: TENANT_ID,
      nombre: 'BistroLink Demo',
      direccion: 'Av. Italia 1234, Montevideo',
      timezone: 'America/Montevideo',
    },
  });

  await prisma.mesa.upsert({
    where: { id: MESA_ID },
    update: {},
    create: {
      id: MESA_ID,
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
      numero: 1,
      estado: 'LIBRE',
    },
  });

  await prisma.categoriaCarta.upsert({
    where: { id: CATEGORIA_ID },
    update: {},
    create: {
      id: CATEGORIA_ID,
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
      nombre: 'Platos principales',
      orden: 1,
    },
  });

  // Un ítem CON imagen (para probar el flujo de URL firmada) y uno SIN
  // imagen (para confirmar que imagenUrl da null en vez de romper).
  await prisma.itemCarta.upsert({
    where: { id: ITEM_CON_IMAGEN_ID },
    update: {},
    create: {
      id: ITEM_CON_IMAGEN_ID,
      tenantId: TENANT_ID,
      categoriaId: CATEGORIA_ID,
      nombre: 'Milanesa a la napolitana',
      descripcion: 'Con papas fritas y ensalada mixta',
      precio: 590,
      disponible: true,
      imagenKey: `${TENANT_ID}/items/milanesa.jpg`,
    },
  });

  await prisma.itemCarta.upsert({
    where: { id: ITEM_SIN_IMAGEN_ID },
    update: {},
    create: {
      id: ITEM_SIN_IMAGEN_ID,
      tenantId: TENANT_ID,
      categoriaId: CATEGORIA_ID,
      nombre: 'Agua con gas',
      descripcion: null,
      precio: 90,
      disponible: false, // para probar el bloqueo visual del frontend más adelante
      imagenKey: null,
    },
  });

  // Mozo del tenant Demo (ver comentario de MOZO_DEMO_KEYCLOAK_ID arriba).
  // Igual que con admin-test: where:{ keycloakId } porque es el dato
  // estable que no cambia si en algún momento se recrea la fila de Postgres.
  await prisma.usuario.upsert({
    where: { keycloakId: MOZO_DEMO_KEYCLOAK_ID },
    update: {},
    create: {
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
      keycloakId: MOZO_DEMO_KEYCLOAK_ID,
      username: 'mozo-test',
      email: 'mozo-test@bistrolink.dev.com',
      rol: 'MOZO',
      activo: true,
    },
  });

  // ── Tenant Ejemplo: fixture de HU-013 (gestión de usuarios/roles) ────────
  // No tiene mesa/categoría/ítems propios porque no se usa para probar
  // HU-001 (menú), sino la gestión de usuarios — si en el futuro hace falta
  // probar el menú también sobre este tenant, agregar esos bloques acá.
  await prisma.tenant.upsert({
    where: { id: TENANT_EJEMPLO_ID },
    update: {},
    create: {
      id: TENANT_EJEMPLO_ID,
      razonSocial: 'Restaurante Ejemplo SRL',
      rut: '210000000000',
      plan: 'BASICO',
    },
  });

  await prisma.$executeRawUnsafe(
    `SELECT set_config('app.tenant_id', $1, false)`,
    TENANT_EJEMPLO_ID,
  );

  await prisma.restaurante.upsert({
    where: { id: RESTAURANTE_EJEMPLO_ID },
    update: {},
    create: {
      id: RESTAURANTE_EJEMPLO_ID,
      tenantId: TENANT_EJEMPLO_ID,
      nombre: 'Restaurante Ejemplo - Sucursal Centro',
      direccion: 'Av. 18 de Julio 1234, Montevideo',
      timezone: 'America/Montevideo',
    },
  });

  // Nota: usamos where:{ keycloakId } porque es el dato estable que no
  // cambia si en algún momento se recrea la fila de Postgres — a diferencia
  // de un id de Postgres autogenerado, que sería distinto cada vez.
  await prisma.usuario.upsert({
    where: { keycloakId: ADMIN_EJEMPLO_KEYCLOAK_ID },
    update: {},
    create: {
      tenantId: TENANT_EJEMPLO_ID,
      restauranteId: RESTAURANTE_EJEMPLO_ID,
      keycloakId: ADMIN_EJEMPLO_KEYCLOAK_ID,
      username: 'admin-test',
      email: 'admin-test@bistrolink.dev.com',
      rol: 'ADMIN',
      activo: true,
    },
  });

  // ── Tenant B: fixture usada para probar aislamiento cruzado (RD.07) ─────
  // Su único propósito en los tests es NO pertenecer al Admin del tenant
  // Ejemplo — ver TC-I-007 (rechazo 403) y TC-I-005 (aislamiento de lectura).
  await prisma.tenant.upsert({
    where: { id: TENANT_B_ID },
    update: {},
    create: {
      id: TENANT_B_ID,
      razonSocial: 'Restaurante Tenant B',
      rut: '210000000001',
      plan: 'BASICO',
    },
  });

  await prisma.$executeRawUnsafe(
    `SELECT set_config('app.tenant_id', $1, false)`,
    TENANT_B_ID,
  );

  await prisma.restaurante.upsert({
    where: { id: RESTAURANTE_B_ID },
    update: {},
    create: {
      id: RESTAURANTE_B_ID,
      tenantId: TENANT_B_ID,
      nombre: 'Restaurante B - Sucursal',
      direccion: 'Otra dirección 456',
      timezone: 'America/Montevideo',
    },
  });

  console.log('✅ Seed aplicado. Probá:');
  console.log(`   GET /menu/${TENANT_ID}/${MESA_ID}`);
  console.log(`   Tenant Ejemplo: ${TENANT_EJEMPLO_ID}`);
  console.log(`   Tenant B:       ${TENANT_B_ID}`);
}

main()
  .catch((e) => {
    console.error('❌ Error en el seed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
  