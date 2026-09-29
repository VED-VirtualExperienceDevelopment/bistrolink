# Servicio de respaldo de bases de datos (HU-029 / BL-183)
#
# Corre como servicio programado (cron) dentro del proyecto de Railway, en la
# misma red privada que bistrolink-db y keycloak-db. Así las bases NO se
# exponen a internet para respaldarse (decisión documentada en el Anexo 12,
# sección 6, y en docs/runbooks/respaldo-y-restauracion.md).
#
# Qué hace en cada ejecución: pg_dump de las dos bases → valida el archivo →
# calcula SHA-256 → lo sube a S3 → verifica el objeto subido → termina.
# Railway marca la ejecución como fallida si el script sale con código ≠ 0.
#
# Versión del cliente de PostgreSQL: pg_dump solo puede respaldar servidores de
# su misma versión mayor o anteriores. Se usa 17 para cubrir servidores 16 y 17.
# Si Railway actualiza las bases a una versión mayor, subir PG_MAJOR.
ARG PG_MAJOR=17
FROM postgres:${PG_MAJOR}-alpine

# aws-cli: subida a S3 y verificación del objeto. coreutils: sha256sum/stat GNU.
RUN apk add --no-cache aws-cli bash coreutils

COPY --chmod=0755 backup.sh /usr/local/bin/backup.sh

# Imagen no-root (política del proyecto). El usuario "postgres" ya existe en la
# imagen base. Los archivos temporales van a /tmp y se borran al terminar.
USER postgres
WORKDIR /tmp

# Es un proceso batch que termina en segundos: no expone ningún puerto ni
# endpoint de salud. El estado se controla por el código de salida (Railway) y
# por el workflow db-backup-check.yml (GitHub), que verifica la antigüedad del
# último respaldo en S3.
HEALTHCHECK NONE

ENTRYPOINT ["/usr/local/bin/backup.sh"]