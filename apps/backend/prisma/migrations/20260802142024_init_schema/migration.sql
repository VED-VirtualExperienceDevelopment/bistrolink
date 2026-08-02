-- CreateEnum
CREATE TYPE "UsuarioRol" AS ENUM ('ADMIN', 'MOZO');

-- CreateEnum
CREATE TYPE "MesaEstado" AS ENUM ('LIBRE', 'OCUPADA');

-- CreateEnum
CREATE TYPE "PedidoEstado" AS ENUM ('RECIBIDO', 'EN_PREPARACION', 'LISTO_PARA_ENTREGAR', 'ENTREGADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "PedidoCanal" AS ENUM ('QR', 'WEB', 'WHATSAPP', 'VOZ');

-- CreateEnum
CREATE TYPE "PagoEstado" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'REEMBOLSADO');

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "razon_social" TEXT NOT NULL,
    "rut" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurante" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "keycloak_id" UUID NOT NULL,
    "rol" "UsuarioRol" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mesa" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "estado" "MesaEstado" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categoria_carta" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categoria_carta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_carta" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "categoria_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_carta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "mesa_id" UUID NOT NULL,
    "usuario_id" UUID,
    "idempotency_key" VARCHAR(64) NOT NULL,
    "estado" "PedidoEstado" NOT NULL,
    "canal" "PedidoCanal" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linea_pedido" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "item_carta_id" UUID NOT NULL,
    "nombre_snapshot" TEXT NOT NULL,
    "precio_unitario_snapshot" DECIMAL(10,2) NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linea_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pago" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(64) NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "medio_pago" TEXT NOT NULL,
    "estado" "PagoEstado" NOT NULL,
    "pasarela_referencia" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobante_fiscal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "pago_id" UUID,
    "tipo_cfe" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "url_xml" TEXT NOT NULL,
    "url_pdf" TEXT NOT NULL,
    "hash_sha256" CHAR(64) NOT NULL,
    "fecha_emision" TIMESTAMP(3) NOT NULL,
    "retencion_hasta" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comprobante_fiscal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_estado_historial" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "usuario_id" UUID,
    "estado_anterior" "PedidoEstado" NOT NULL,
    "estado_nuevo" "PedidoEstado" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedido_estado_historial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurante_tenant_id_idx" ON "restaurante"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_keycloak_id_key" ON "usuario"("keycloak_id");

-- CreateIndex
CREATE INDEX "usuario_tenant_id_idx" ON "usuario"("tenant_id");

-- CreateIndex
CREATE INDEX "mesa_tenant_id_idx" ON "mesa"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mesa_restaurante_id_numero_key" ON "mesa"("restaurante_id", "numero");

-- CreateIndex
CREATE INDEX "categoria_carta_tenant_id_idx" ON "categoria_carta"("tenant_id");

-- CreateIndex
CREATE INDEX "item_carta_tenant_id_idx" ON "item_carta"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_idempotency_key_key" ON "pedido"("idempotency_key");

-- CreateIndex
CREATE INDEX "pedido_tenant_id_idx" ON "pedido"("tenant_id");

-- CreateIndex
CREATE INDEX "linea_pedido_tenant_id_idx" ON "linea_pedido"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "pago_idempotency_key_key" ON "pago"("idempotency_key");

-- CreateIndex
CREATE INDEX "pago_tenant_id_idx" ON "pago"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "comprobante_fiscal_hash_sha256_key" ON "comprobante_fiscal"("hash_sha256");

-- CreateIndex
CREATE INDEX "comprobante_fiscal_tenant_id_idx" ON "comprobante_fiscal"("tenant_id");

-- CreateIndex
CREATE INDEX "pedido_estado_historial_tenant_id_idx" ON "pedido_estado_historial"("tenant_id");

-- AddForeignKey
ALTER TABLE "restaurante" ADD CONSTRAINT "restaurante_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mesa" ADD CONSTRAINT "mesa_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categoria_carta" ADD CONSTRAINT "categoria_carta_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_carta" ADD CONSTRAINT "item_carta_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categoria_carta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_mesa_id_fkey" FOREIGN KEY ("mesa_id") REFERENCES "mesa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_pedido" ADD CONSTRAINT "linea_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_pedido" ADD CONSTRAINT "linea_pedido_item_carta_id_fkey" FOREIGN KEY ("item_carta_id") REFERENCES "item_carta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobante_fiscal" ADD CONSTRAINT "comprobante_fiscal_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobante_fiscal" ADD CONSTRAINT "comprobante_fiscal_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pago"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_estado_historial" ADD CONSTRAINT "pedido_estado_historial_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_estado_historial" ADD CONSTRAINT "pedido_estado_historial_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
