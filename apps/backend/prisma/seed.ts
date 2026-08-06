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

  console.log('✅ Seed aplicado. Probá:');
  console.log(`   GET /menu/${TENANT_ID}/${MESA_ID}`);
}

main()
  .catch((e) => {
    console.error('❌ Error en el seed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
