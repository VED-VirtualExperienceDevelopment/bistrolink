import 'dotenv/config';
import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { StorageService } from '../src/menu/storage.service';
import { ProcesadorImagenService } from '../src/menu/procesador-imagen.service';
import { AuditLogService } from '../src/audit-log/audit-log.service';
import { AuditAction } from '../src/audit-log/audit-action.enum';

/**
 * BL-390 (BL-385): reprocesa las imágenes de la carta subidas antes de la
 * carga segura. Se corre UNA vez por entorno.
 *
 * Por cada ítem con imagen que no tiene el formato nuevo
 * ({tenant}/menu/{uuid}.webp):
 * 1. Lee el original del bucket (máximo 5 MB).
 * 2. Lo pasa por el mismo procesador que la confirmación (BL-386): verifica
 *    que sea una imagen real y genera un WebP sin metadatos, de hasta 1600 px.
 * 3. Publica el WebP con una key nueva y actualiza imagen_key del ítem.
 * 4. Deja el cambio en la auditoría (actor "script:<usuario>").
 *
 * Por defecto SOLO SIMULA: lee y procesa, pero no escribe nada. Para
 * aplicar los cambios se agrega --aplicar.
 *
 * Uso (desde la raíz del repo):
 *   npm run reprocesar-imagenes --workspace=apps/backend
 *   npm run reprocesar-imagenes --workspace=apps/backend -- --aplicar
 *   npm run reprocesar-imagenes --workspace=apps/backend -- --tenant=<uuid>
 *
 * Variables de entorno:
 * - RUNTIME_DATABASE_URL: la base, con el rol de la aplicación (respeta RLS).
 * - S3_BUCKET_IMAGES, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY:
 *   el bucket de imágenes del entorno y la clave de la aplicación.
 *
 * Seguridad:
 * - Una key que no está bajo {tenant}/menu/ del propio ítem NO se lee: se
 *   informa para revisarla a mano (podría ser una imagen de otro tenant).
 * - El ítem se actualiza solo si su imagen no cambió mientras corría el
 *   script (si un administrador la reemplazó, se respeta la suya).
 * - El original no se borra (la aplicación no tiene permiso de borrado);
 *   queda en el bucket sin uso. Es idempotente: correrlo de nuevo solo
 *   procesa lo que falte.
 */

interface Resumen {
  revisados: number;
  aReprocesar: number;
  reprocesados: number;
  omitidos: number;
  fallidos: number;
  bytesAntes: number;
  bytesDespues: number;
}

const ARG_APLICAR = '--aplicar';
const ARG_TENANT = '--tenant=';

function leerArgumentos(): { aplicar: boolean; tenantId?: string } {
  const args = process.argv.slice(2);
  const desconocidos = args.filter(
    (a) => a !== ARG_APLICAR && !a.startsWith(ARG_TENANT),
  );
  if (desconocidos.length > 0) {
    console.error(`Argumentos desconocidos: ${desconocidos.join(' ')}`);
    console.error('Uso: reprocesar-imagenes [--aplicar] [--tenant=<uuid>]');
    process.exit(1);
  }
  const tenant = args.find((a) => a.startsWith(ARG_TENANT));
  return {
    aplicar: args.includes(ARG_APLICAR),
    tenantId: tenant ? tenant.slice(ARG_TENANT.length) : undefined,
  };
}

function verificarEntorno(): void {
  const faltantes = ['RUNTIME_DATABASE_URL', 'S3_BUCKET_IMAGES'].filter(
    (nombre) => !process.env[nombre],
  );
  if (faltantes.length > 0) {
    console.error(`Faltan variables de entorno: ${faltantes.join(', ')}`);
    process.exit(1);
  }
}

function motivoDelFallo(error: unknown): string {
  // leerDeCuarentena se usa para cualquier key; su mensaje de 404 está
  // pensado para el formulario, acá se aclara.
  if (error instanceof NotFoundException) {
    return 'el archivo no existe en el bucket (el ítem queda como está)';
  }
  return error instanceof Error ? error.message : 'error sin detalle';
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function main(): Promise<void> {
  const { aplicar, tenantId: soloTenant } = leerArgumentos();
  verificarEntorno();

  const prisma = new PrismaClient({
    datasourceUrl: process.env.RUNTIME_DATABASE_URL,
  });
  const storage = new StorageService();
  const procesador = new ProcesadorImagenService();
  const auditoria = new AuditLogService();
  const actor = `script:${userInfo().username}`;

  // Mismo patrón que TenantPrismaService: cada consulta a una tabla con RLS
  // corre en una transacción con app.tenant_id fijado.
  const enTenant = <T>(
    tenantId: string,
    fn: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.tenant_id', $1, true)`,
        tenantId,
      );
      return fn(tx as unknown as PrismaClient);
    });

  const resumen: Resumen = {
    revisados: 0,
    aReprocesar: 0,
    reprocesados: 0,
    omitidos: 0,
    fallidos: 0,
    bytesAntes: 0,
    bytesDespues: 0,
  };

  console.log(
    aplicar
      ? '▶ Modo APLICAR: se publican las imágenes nuevas y se actualizan los ítems.'
      : '▶ Modo SIMULACIÓN: no se escribe nada. Agregá --aplicar para aplicar los cambios.',
  );
  console.log(`  Bucket: ${process.env.S3_BUCKET_IMAGES}\n`);

  try {
    // La tabla tenant no tiene RLS: el rol de la aplicación puede listarla.
    const tenants = await prisma.tenant.findMany({
      where: soloTenant ? { id: soloTenant } : undefined,
      select: { id: true, razonSocial: true },
      orderBy: { createdAt: 'asc' },
    });
    if (soloTenant && tenants.length === 0) {
      console.error(`No existe el tenant ${soloTenant}`);
      process.exitCode = 1;
      return;
    }

    for (const tenant of tenants) {
      const items = await enTenant(tenant.id, (tx) =>
        tx.itemCarta.findMany({
          where: { imagenKey: { not: null } },
          select: { id: true, nombre: true, imagenKey: true },
          orderBy: { nombre: 'asc' },
        }),
      );
      resumen.revisados += items.length;

      const pendientes = items.filter(
        (item) => !storage.esKeyDelTenant(item.imagenKey!, tenant.id),
      );
      if (pendientes.length === 0) continue;

      console.log(`■ ${tenant.razonSocial} (${tenant.id})`);

      for (const item of pendientes) {
        const keyOriginal = item.imagenKey!;
        const etiqueta = `  - ${item.nombre} (${item.id})`;

        // Solo se leen keys del propio tenant. Una key ajena o rara se
        // informa y se revisa a mano.
        if (
          !keyOriginal.startsWith(`${tenant.id}/menu/`) ||
          keyOriginal.includes('..')
        ) {
          resumen.omitidos++;
          console.log(`${etiqueta}: OMITIDA, la key no es de este tenant`);
          continue;
        }

        resumen.aReprocesar++;
        try {
          const original = await storage.leerDeCuarentena(keyOriginal);
          const procesada = await procesador.procesar(original);
          resumen.bytesAntes += original.length;
          resumen.bytesDespues += procesada.length;

          if (!aplicar) {
            console.log(
              `${etiqueta}: se reprocesaría (${kb(original.length)} → ${kb(procesada.length)})`,
            );
            continue;
          }

          const keyNueva = `${tenant.id}/menu/${randomUUID()}.webp`;
          await storage.guardarImagenPublicada(keyNueva, procesada);

          // Solo si la imagen del ítem sigue siendo la que se procesó.
          const { count } = await enTenant(tenant.id, (tx) =>
            tx.itemCarta.updateMany({
              where: { id: item.id, imagenKey: keyOriginal },
              data: { imagenKey: keyNueva },
            }),
          );
          if (count === 0) {
            resumen.omitidos++;
            resumen.aReprocesar--;
            console.log(
              `${etiqueta}: OMITIDA, la imagen cambió mientras corría el script`,
            );
            continue;
          }

          auditoria.registrar({
            action: AuditAction.CARTA_ITEM_IMAGEN_CAMBIADA,
            tenantId: tenant.id,
            actorKeycloakId: actor,
            detalle: {
              itemId: item.id,
              imagenKeyAnterior: keyOriginal,
              imagenKeyNueva: keyNueva,
              motivo: 'reprocesamiento BL-390',
            },
          });
          resumen.reprocesados++;
          console.log(
            `${etiqueta}: reprocesada (${kb(original.length)} → ${kb(procesada.length)})`,
          );
        } catch (error) {
          resumen.fallidos++;
          console.log(`${etiqueta}: FALLÓ, ${motivoDelFallo(error)}`);
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log('\nResumen');
  console.log(`  Ítems con imagen revisados: ${resumen.revisados}`);
  console.log(`  A reprocesar:               ${resumen.aReprocesar}`);
  if (aplicar) {
    console.log(`  Reprocesados:               ${resumen.reprocesados}`);
  }
  console.log(`  Omitidos (revisar a mano):  ${resumen.omitidos}`);
  console.log(`  Fallidos:                   ${resumen.fallidos}`);
  if (resumen.bytesAntes > 0) {
    console.log(
      `  Peso total: ${kb(resumen.bytesAntes)} → ${kb(resumen.bytesDespues)}`,
    );
  }

  if (resumen.fallidos > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exit(1);
});
