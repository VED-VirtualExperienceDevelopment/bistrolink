-- BL-163 (HU-027): quién dio el alta del establecimiento (username del
-- usuario de plataforma o "script:<usuario>"). Nullable: los tenants que ya
-- existen no tienen el dato. La tabla tenant no tiene RLS.
ALTER TABLE "tenant" ADD COLUMN     "creado_por" TEXT;
