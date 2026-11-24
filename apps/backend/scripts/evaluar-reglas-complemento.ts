import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  evaluarReglas,
  type PlatosDelPedido,
} from '../src/complementos/evaluacion-reglas';
import { VENTANA_REGLAS_DIAS } from '../src/complementos/reglas-complemento';

/**
 * HU-046 (BL-555): validación offline de las reglas de complemento (hit
 * rate@2 contra el baseline de popularidad). El protocolo está en
 * src/complementos/evaluacion-reglas.ts.
 *
 * Solo lee: la transacción es READ ONLY y corre en el contexto del tenant
 * (RLS). No muestra nombres ni datos de comensales: solo cantidades.
 *
 * Uso (desde la raíz del repo):
 *   npm run evaluar-complementos --workspace=apps/backend -- --tenant=<uuid>
 *   ... -- --tenant=<uuid> --hasta=2026-11-20 --semanas-prueba=2 --json
 *
 * - --hasta: último día de la prueba (AAAA-MM-DD, hora de Montevideo).
 *   Por defecto, hoy.
 * - --semanas-prueba: cuántas semanas son de prueba (por defecto 1). El
 *   entrenamiento son los 90 días anteriores, como el job nocturno.
 *
 * Variable de entorno: RUNTIME_DATABASE_URL (el rol de la aplicación).
 */

const DIA_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
// Uruguay no tiene horario de verano: el día local empieza a las 03:00 UTC.
const DESFASE_MONTEVIDEO = '-03:00';

interface Argumentos {
  tenantId: string;
  hasta: string;
  semanasPrueba: number;
  json: boolean;
}

function hoyEnMontevideo(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montevideo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function leerArgumentos(): Argumentos {
  const valor = (nombre: string) =>
    process.argv
      .slice(2)
      .find((a) => a.startsWith(`--${nombre}=`))
      ?.split('=')[1];
  const tenantId = valor('tenant') ?? '';
  const hasta = valor('hasta') ?? hoyEnMontevideo();
  const semanasPrueba = Number(valor('semanas-prueba') ?? '1');
  if (
    !UUID.test(tenantId) ||
    !FECHA.test(hasta) ||
    !Number.isInteger(semanasPrueba) ||
    semanasPrueba < 1
  ) {
    console.error(
      'Uso: evaluar-complementos --tenant=<uuid> [--hasta=AAAA-MM-DD] [--semanas-prueba=1] [--json]',
    );
    process.exit(1);
  }
  return {
    tenantId,
    hasta,
    semanasPrueba,
    json: process.argv.includes('--json'),
  };
}

/** Inicio del día local (Montevideo) como instante. */
function inicioDelDia(dia: string): Date {
  return new Date(`${dia}T00:00:00${DESFASE_MONTEVIDEO}`);
}

async function main(): Promise<void> {
  const args = leerArgumentos();
  if (!process.env.RUNTIME_DATABASE_URL) {
    console.error('Falta RUNTIME_DATABASE_URL.');
    process.exit(1);
  }
  const finPrueba = new Date(inicioDelDia(args.hasta).getTime() + DIA_MS);
  const inicioPrueba = new Date(
    finPrueba.getTime() - args.semanasPrueba * 7 * DIA_MS,
  );
  const inicioEntrenamiento = new Date(
    inicioPrueba.getTime() - VENTANA_REGLAS_DIAS * DIA_MS,
  );

  const prisma = new PrismaClient({
    datasourceUrl: process.env.RUNTIME_DATABASE_URL,
  });
  try {
    const { pedidos, sugeribles } = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.tenant_id', $1, true)`,
        args.tenantId,
      );
      // Cada pedido con pago aprobado, con su primer pago y sus platos.
      const filas = await tx.$queryRaw<
        { pagado_en: Date; platos: string[] }[]
      >(Prisma.sql`
        SELECT pagados.pagado_en,
               array_agg(DISTINCT lp.item_carta_id::text) AS platos
        FROM (
          SELECT pedido_id, MIN(created_at) AS pagado_en
          FROM pago
          WHERE tenant_id = ${args.tenantId}::uuid
            AND estado = 'APROBADO'
          GROUP BY pedido_id
        ) pagados
        JOIN linea_pedido lp
          ON lp.pedido_id = pagados.pedido_id
         AND lp.tenant_id = ${args.tenantId}::uuid
        WHERE pagados.pagado_en >= ${inicioEntrenamiento}
          AND pagados.pagado_en < ${finPrueba}
        GROUP BY pagados.pedido_id, pagados.pagado_en`);
      const items = await tx.itemCarta.findMany({
        where: {
          tenantId: args.tenantId,
          sugerible: true,
          contieneAlcohol: false,
          archivadoEn: null,
        },
        select: { id: true },
      });
      return { pedidos: filas, sugeribles: new Set(items.map((i) => i.id)) };
    });

    const entrenamiento: PlatosDelPedido[] = [];
    const prueba: PlatosDelPedido[] = [];
    for (const { pagado_en, platos } of pedidos) {
      (pagado_en < inicioPrueba ? entrenamiento : prueba).push(platos);
    }
    const resultado = evaluarReglas({ entrenamiento, prueba, sugeribles });
    const informe = {
      tenantId: args.tenantId,
      entrenamiento: {
        desde: inicioEntrenamiento.toISOString(),
        hasta: inicioPrueba.toISOString(),
      },
      prueba: {
        desde: inicioPrueba.toISOString(),
        hasta: finPrueba.toISOString(),
      },
      platosSugeribles: sugeribles.size,
      ...resultado,
    };

    if (args.json) {
      console.log(JSON.stringify(informe, null, 2));
      return;
    }
    console.log('Validación offline de las reglas de complemento (HU-046)');
    console.log(
      `Entrenamiento: ${informe.entrenamiento.desde} a ${informe.entrenamiento.hasta} (${resultado.pedidosEntrenamiento} pedidos, ${resultado.reglas} reglas)`,
    );
    console.log(
      `Prueba: ${informe.prueba.desde} a ${informe.prueba.hasta} (${resultado.pedidosEvaluados} pedidos evaluados)`,
    );
    console.log(`Platos sugeribles: ${sugeribles.size}`);
    console.log('');
    console.log('| Modelo | hit rate@2 | Aciertos | Pedidos evaluados |');
    console.log('|--|--|--|--|');
    console.log(
      `| Reglas de asociación (con respaldo) | ${resultado.hitRateReglas} % | ${resultado.aciertosReglas} | ${resultado.pedidosEvaluados} |`,
    );
    console.log(
      `| Popularidad (baseline, HU-045) | ${resultado.hitRatePopularidad} % | ${resultado.aciertosPopularidad} | ${resultado.pedidosEvaluados} |`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exit(1);
});
