-- HU-046 (BL-551): platos que se pueden sugerir como complemento antes de
-- pagar, y platos con alcohol. Los existentes quedan sin marcar: nada se
-- sugiere hasta que el administrador lo elige.
ALTER TABLE "item_carta"
  ADD COLUMN "sugerible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contiene_alcohol" BOOLEAN NOT NULL DEFAULT false;

-- Un plato con alcohol nunca se sugiere. La API responde 400 antes de
-- llegar acá; el CHECK lo asegura también ante cualquier otra escritura.
ALTER TABLE "item_carta"
  ADD CONSTRAINT "item_carta_alcohol_no_sugerible"
  CHECK (NOT ("sugerible" AND "contiene_alcohol"));
