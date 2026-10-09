/*
  Warnings:

  - A unique constraint covering the columns `[tenant_id]` on the table `restaurante` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[rut]` on the table `tenant` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "restaurante_tenant_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "restaurante_tenant_id_key" ON "restaurante"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_rut_key" ON "tenant"("rut");
