-- AlterEnum
ALTER TYPE "MesaEstado" ADD VALUE 'EN_PROCESO_DE_PAGO';

-- AlterTable
ALTER TABLE "mesa" ADD COLUMN     "layout" JSONB;
