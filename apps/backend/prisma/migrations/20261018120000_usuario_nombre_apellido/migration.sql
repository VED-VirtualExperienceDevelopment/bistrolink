-- BL-361: nombre y apellido del usuario (copia de firstName/lastName de
-- Keycloak). Nulos en los usuarios existentes: la app muestra el username.
-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "apellido" TEXT,
ADD COLUMN     "nombre" TEXT;