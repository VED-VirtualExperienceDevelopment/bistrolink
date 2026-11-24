-- HU-044 (BL-537): «Sugerencia del local» (destacado del chef).
-- Los platos existentes quedan sin destacar; el seed no trae destacados.
ALTER TABLE "item_carta"
  ADD COLUMN "destacado" BOOLEAN NOT NULL DEFAULT false;
