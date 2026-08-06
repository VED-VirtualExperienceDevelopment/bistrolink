import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as QRCode from 'qrcode';

// Script de Sprint 1 para HU-001: genera el PNG del QR que un comensal
// escanea en la mesa. Apunta directo a la página del menú
// (apps/frontend/src/app/m/[tenantId]/[mesaId]/page.tsx).
//
// No es un endpoint ni tiene UI de administración a propósito — eso
// corresponde a HU-005/HU-016 (gestión de carta y mapa de mesas), más
// adelante en el cronograma. Acá alcanza con poder generar el QR a mano
// para probar el flujo end-to-end del comensal.
//
// Uso:
//   npx ts-node scripts/generate-qr.ts <tenantId> <mesaId> [numeroMesa]

const [, , tenantId, mesaId, numeroMesa] = process.argv;

if (!tenantId || !mesaId) {
  console.error(
    'Uso: npx ts-node scripts/generate-qr.ts <tenantId> <mesaId> [numeroMesa]',
  );
  console.error(
    'Ejemplo: npx ts-node scripts/generate-qr.ts 11111111-1111-1111-1111-111111111111 33333333-3333-3333-3333-333333333333 1',
  );
  process.exit(1);
}

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';
const url = `${FRONTEND_URL}/m/${tenantId}/${mesaId}`;

const outDir = path.join(__dirname, '..', 'qrcodes');
fs.mkdirSync(outDir, { recursive: true });

const filename = `mesa-${numeroMesa ?? mesaId}.png`;
const outPath = path.join(outDir, filename);

QRCode.toFile(outPath, url, { width: 512, margin: 2 })
  .then(() => {
    console.log(`✅ QR generado: ${outPath}`);
    console.log(`   Apunta a: ${url}`);
  })
  .catch((err) => {
    console.error('❌ Error generando el QR:', err);
    process.exit(1);
  });
