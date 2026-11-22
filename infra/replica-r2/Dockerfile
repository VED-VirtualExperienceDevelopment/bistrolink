# Réplica de los respaldos y de los CFE en Cloudflare R2 (HU-030 / BL-184)
#
# Corre como servicio programado (cron) en el entorno production de Railway,
# igual que db-backup (infra/backup). En cada ejecución copia de Amazon S3 a
# Cloudflare R2 los objetos nuevos de los dos buckets de producción:
#   bistrolink-backups-prod → bistrolink-backups-prod-replica (dumps diarios)
#   bistrolink-cfe-prod     → bistrolink-cfe-prod-replica     (PDF de los CFE)
# Completa la regla 3-2-1: una copia fuera de Amazon. Cómo se configura y
# cómo se restaura: docs/runbooks/respaldo-y-restauracion.md, sección 9.
#
# Usa «rclone copy» (nunca «sync»): un borrado en S3 no se propaga a R2.
FROM alpine:3.22

# rclone: copia entre S3 y R2 (los dos con API S3). bash y coreutils: el script.
RUN apk add --no-cache rclone bash coreutils ca-certificates

COPY --chmod=0755 replica.sh /usr/local/bin/replica.sh

# Imagen no-root (política del proyecto). rclone no guarda nada en disco: la
# configuración va por variables de entorno.
RUN adduser -D -H -u 10001 replica
USER replica
WORKDIR /tmp

# Proceso batch, sin puertos ni endpoint de salud. El estado se controla por el
# código de salida (Railway) y por db-backup-check.yml (GitHub), que verifica
# en R2 la marca de la última réplica.
HEALTHCHECK NONE

ENTRYPOINT ["/usr/local/bin/replica.sh"]
