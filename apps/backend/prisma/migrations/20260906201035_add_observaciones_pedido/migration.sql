-- AlterTable
ALTER TABLE "linea_pedido" ADD COLUMN     "observacion" VARCHAR(300);

-- AlterTable
ALTER TABLE "pedido" ADD COLUMN     "observacion_general" VARCHAR(500);
