-- AlterEnum
ALTER TYPE "MesaEstado" ADD VALUE 'REQUIERE_LIMPIEZA';

-- AlterTable
ALTER TABLE "restaurante" ADD COLUMN     "plano" JSONB;
