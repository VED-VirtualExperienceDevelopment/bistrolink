import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { TenantPrismaService } from '../../../src/prisma/tenant-prisma.service';
import { QrMesaTokenService } from '../../../src/qr-mesa/qr-mesa-token.service';

/**
 * HU-034 (BL-204): token del QR vigente de una mesa, para los tests de
 * integración que hacen pedidos o llamados desde la mesa.
 *
 * Desde BL-204 la mesa solo se usa con el token de su QR: POST
 * /auth/comensal/mesa { qrToken } y el header X-Mesa-Token en POST /pedidos
 * y POST /mesas/llamar. El token se arma con los mismos servicios de la app
 * (la versión actual del QR sale de la base), sin regenerarlo: regenerar
 * invalidaría el QR de otros tests y de los E2E.
 *
 * Si el entorno no tiene QR_TOKEN_KEY, se usa una clave aleatoria: el token
 * lo emite y lo valida la misma instancia de la app, así que cualquier clave
 * sirve. Se llama ANTES de crear la app.
 */
export function asegurarClaveQr(): void {
  if (!process.env.QR_TOKEN_KEY) {
    process.env.QR_TOKEN_KEY = randomBytes(32).toString('base64');
  }
}

export async function tokenQrDeMesa(
  app: INestApplication,
  tenantId: string,
  mesaId: string,
): Promise<string> {
  // TenantPrismaService es un provider con scope (no singleton): Nest no
  // deja pedirlo con app.get(), hay que resolverlo.
  const tenantPrisma = await app.resolve(TenantPrismaService);
  const mesa = await tenantPrisma.runInTenantContext(tenantId, (tx) =>
    tx.mesa.findUnique({
      where: { id: mesaId },
      select: { qrVersion: true },
    }),
  );
  if (!mesa) {
    throw new Error(
      `La mesa ${mesaId} no existe en el tenant ${tenantId} (¿seed?)`,
    );
  }
  return app
    .get(QrMesaTokenService)
    .cifrar({ tenantId, mesaId, version: mesa.qrVersion });
}
