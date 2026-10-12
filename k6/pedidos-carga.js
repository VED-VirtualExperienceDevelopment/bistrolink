import * as fs from 'node:fs';
import * as path from 'node:path';
import * as QRCode from 'qrcode';

// Genera el PNG del QR que un comensal escanea en la mesa, a partir de la
// URL que devuelve la API.
//
// HU-034 (BL-204): la URL de la mesa ya no se arma con ids
// (/m/<tenantId>/<mesaId>): es /q/<token>, con un token cifrado que solo
// emite el backend. Por eso el script ya no recibe ids: recibe la URL de
// GET /mesas/qr (como ADMIN), que lista la de cada mesa. El PDF imprimible
// para el administrador lo arma el panel de administración.
//
// Uso:
//   npx ts-node scripts/generate-qr.ts <url-del-qr> [numeroMesa]

const [, , url, numeroMesa] = process.argv;

function esUrlDeQr(valor: string | undefined): valor is string {
  if (!valor) return false;
  try {
    return /^\/q\/[A-Za-z0-9_-]+$/.test(new URL(valor).pathname);
  } catch {
    return false;
  }
}

if (!esUrlDeQr(url)) {
  console.error(
    'Uso: npx ts-node scripts/generate-qr.ts <url-del-qr> [numeroMesa]',
  );
  console.error(
    'La URL es la que devuelve GET /mesas/qr para cada mesa (…/q/<token>).',
  );
  process.exit(1);
}

const outDir = path.join(__dirname, '..', 'qrcodes');
fs.mkdirSync(outDir, { recursive: true });

const filename = `mesa-${numeroMesa ?? 'qr'}.png`;
const outPath = path.join(outDir, filename);

QRCode.toFile(outPath, url, { width: 512, margin: 2 })
  .then(() => {
    console.log(`✅ QR generado: ${outPath}`);
  })
  .catch((err) => {
    console.error('❌ Error generando el QR:', err);
    process.exit(1);
  });
  