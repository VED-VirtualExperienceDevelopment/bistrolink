#!/usr/bin/env bash
# Respaldo diario de las bases de BistroLink a Amazon S3 (HU-029 / BL-183).
#
# Variables de entorno (se configuran en el servicio de Railway, ver
# docs/runbooks/respaldo-y-restauracion.md):
#   BACKUP_ENVIRONMENT       staging | prod (solo para etiquetar y loguear)
#   S3_BUCKET                bistrolink-backups-staging | bistrolink-backups-prod
#   AWS_REGION               us-east-2
#   AWS_ACCESS_KEY_ID        del usuario IAM bistrolink-backup-ci
#   AWS_SECRET_ACCESS_KEY    del usuario IAM bistrolink-backup-ci
#   BISTROLINK_DATABASE_URL  URL INTERNA de bistrolink-db  (${{bistrolink-db.DATABASE_URL}})
#   KEYCLOAK_DATABASE_URL    URL INTERNA de keycloak-db    (${{keycloak-db.DATABASE_URL}})
#   MIN_BYTES                (opcional) tamaño mínimo aceptable de un dump. Default 1024.
#
# Estructura en el bucket (las reglas de ciclo de vida dependen de estos prefijos):
#   daily/<base>/<yyyy>/<mm>/<yyyy-mm-dd>.dump        (+ .sha256)  → se conserva 35 días
#   monthly/<base>/<yyyy>/<yyyy-mm>.dump              (+ .sha256)  → se conserva 365 días
#
# Reglas de seguridad del script:
#   - Nunca imprime las URLs de conexión (contienen la contraseña).
#   - Falla ante cualquier error (set -Eeuo pipefail): un respaldo parcial no
#     se reporta como exitoso.
set -Eeuo pipefail

log() { printf '%s level=%s entorno=%s %s\n' "$(date -u +%FT%TZ)" "$1" "${BACKUP_ENVIRONMENT:-?}" "$2"; }
fail() { log error "$1"; exit 1; }
trap 'fail "falló el paso en la línea $LINENO"' ERR

for var in BACKUP_ENVIRONMENT S3_BUCKET AWS_REGION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY \
           BISTROLINK_DATABASE_URL KEYCLOAK_DATABASE_URL; do
  [ -n "${!var:-}" ] || fail "falta la variable de entorno $var"
done

MIN_BYTES="${MIN_BYTES:-1024}"
FECHA="$(date -u +%F)"        # yyyy-mm-dd (UTC)
ANIO="$(date -u +%Y)"
MES="$(date -u +%m)"
DIA="$(date -u +%d)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# La red privada de Railway puede tardar unos segundos en estar disponible al
# arrancar el contenedor: se reintenta la conexión antes de declarar la falla.
esperar_base() {
  local nombre="$1" url="$2" intento
  for intento in 1 2 3 4 5 6; do
    if pg_isready --dbname="$url" --timeout=5 >/dev/null 2>&1; then
      return 0
    fi
    log warn "base=$nombre no responde todavía (intento $intento/6); reintento en 5 s"
    sleep 5
  done
  fail "base=$nombre no respondió después de 6 intentos"
}

subir() {
  # subir <archivo local> <key en S3> <sha256> <base>
  aws s3api put-object \
    --bucket "$S3_BUCKET" --key "$2" --body "$1" \
    --checksum-algorithm SHA256 \
    --metadata "sha256=$3,base=$4,entorno=$BACKUP_ENVIRONMENT" \
    --output text --query 'ETag' >/dev/null
}

respaldar() {
  local nombre="$1" url="$2"
  local archivo="$WORK/$nombre.dump" inicio fin tamanio sha key_diario key_sha tamanio_s3

  esperar_base "$nombre" "$url"
  inicio="$(date +%s)"

  # --no-owner / --no-acl: el dump se puede restaurar en otra instancia con
  # otro usuario (entorno efímero de verificación o contingencia en Render).
  pg_dump --format=custom --compress=9 --no-owner --no-acl \
          --dbname="$url" --file="$archivo"

  # Validación local: el archivo tiene que ser un dump legible por pg_restore.
  pg_restore --list "$archivo" >/dev/null

  tamanio="$(stat -c%s "$archivo")"
  [ "$tamanio" -ge "$MIN_BYTES" ] || fail "base=$nombre dump demasiado chico ($tamanio bytes < $MIN_BYTES)"
  sha="$(sha256sum "$archivo" | cut -d' ' -f1)"
  printf '%s  %s.dump\n' "$sha" "$FECHA" > "$WORK/$nombre.sha256"

  key_diario="daily/$nombre/$ANIO/$MES/$FECHA.dump"
  key_sha="daily/$nombre/$ANIO/$MES/$FECHA.sha256"
  subir "$archivo" "$key_diario" "$sha" "$nombre"
  subir "$WORK/$nombre.sha256" "$key_sha" "$sha" "$nombre"

  # Verificación remota: el objeto existe y tiene el mismo tamaño que el local.
  tamanio_s3="$(aws s3api head-object --bucket "$S3_BUCKET" --key "$key_diario" \
                 --query 'ContentLength' --output text)"
  [ "$tamanio_s3" = "$tamanio" ] || fail "base=$nombre tamaño en S3 ($tamanio_s3) distinto del local ($tamanio)"

  # El primer día de cada mes, el mismo dump se guarda también como mensual.
  if [ "$DIA" = "01" ]; then
    subir "$archivo" "monthly/$nombre/$ANIO/$ANIO-$MES.dump" "$sha" "$nombre"
    subir "$WORK/$nombre.sha256" "monthly/$nombre/$ANIO/$ANIO-$MES.sha256" "$sha" "$nombre"
    log info "base=$nombre copia mensual guardada en monthly/$nombre/$ANIO/$ANIO-$MES.dump"
  fi

  fin="$(date +%s)"
  log info "base=$nombre resultado=ok bytes=$tamanio sha256=$sha segundos=$((fin - inicio)) destino=s3://$S3_BUCKET/$key_diario"
}

log info "inicio del respaldo diario (bucket=$S3_BUCKET, fecha=$FECHA)"
respaldar "bistrolink-db" "$BISTROLINK_DATABASE_URL"
respaldar "keycloak-db"   "$KEYCLOAK_DATABASE_URL"
log info "respaldo diario completo: 2 de 2 bases"