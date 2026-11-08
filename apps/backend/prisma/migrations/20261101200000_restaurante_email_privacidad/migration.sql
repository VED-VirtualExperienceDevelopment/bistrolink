-- HU-036 (BL-206): correo de contacto para los derechos de los titulares de
-- datos personales (Ley 18.331: acceso, rectificación y supresión). El
-- responsable de los datos es el establecimiento: cada uno publica el suyo
-- en su política de privacidad. Lo carga el Administrador en la
-- configuración (HU-020).
--
-- Migración ADITIVA (expand/contract, RNF.06): una columna nullable, sin
-- default. La versión anterior de la API no la lee. ALTER TABLE no pasa por
-- RLS.

ALTER TABLE "restaurante" ADD COLUMN "email_privacidad" VARCHAR(254);
