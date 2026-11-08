-- BL-311 (RD.05): token de acceso de los pedidos para retirar (canal WEB).
-- Se guarda solo el SHA-256; los pedidos de mesa se autorizan con el QR.
-- AlterTable
ALTER TABLE "pedido" ADD COLUMN     "acceso_token_hash" CHAR(64);
