-- HU-020 (BL-72): configuración del establecimiento.
--
-- Columnas directas en "restaurante" (un tenant tiene un solo restaurante):
-- medios de pago digitales habilitados, porcentajes de propina sugeridos y
-- proveedor de CFE. El flag de efectivo ya existe (efectivo_habilitado,
-- HU-031) y se reusa. La razón social y el RUT ya están en "tenant".
--
-- Migración ADITIVA (expand/contract, RNF.06): solo agrega un tipo, columnas
-- con default y una restricción. Las filas existentes quedan como opera hoy
-- la API (Mercado Pago y Plexo habilitados, Handy no, CFE con Surtec, sin
-- propinas sugeridas), y la versión anterior sigue funcionando porque no lee
-- las columnas nuevas. No hace falta fijar app.tenant_id: ALTER TABLE no pasa
-- por RLS.

-- ── Proveedor de CFE ──────────────────────────────────────────────────────────

CREATE TYPE "CfeProveedor" AS ENUM ('SURTEC', 'BILLER');

-- ── restaurante ───────────────────────────────────────────────────────────────

ALTER TABLE "restaurante"
  ADD COLUMN "mercadopago_habilitado" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "plexo_habilitado" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "handy_habilitado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "propinas_sugeridas" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "cfe_proveedor" "CfeProveedor" NOT NULL DEFAULT 'SURTEC';

-- La base es la última línea de defensa de las propinas (el DTO valida lo
-- mismo con mensajes claros): sin nulos, hasta 5 valores, cada uno entre 1 y
-- 100. La lista vacía es válida (sin sugerencias). La columna queda sin
-- NOT NULL en la definición, igual que la genera Prisma para un Int[] (así
-- `migrate diff` no ve diferencias); el CHECK impide el nulo.
ALTER TABLE "restaurante"
  ADD CONSTRAINT "restaurante_propinas_sugeridas_validas" CHECK (
    "propinas_sugeridas" IS NOT NULL
    AND array_position("propinas_sugeridas", NULL) IS NULL
    AND cardinality("propinas_sugeridas") <= 5
    AND 1 <= ALL ("propinas_sugeridas")
    AND 100 >= ALL ("propinas_sugeridas")
  );
