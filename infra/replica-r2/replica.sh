#!/usr/bin/env bash
# Réplica de Amazon S3 a Cloudflare R2 (HU-030 / BL-184).
#
# Variables de entorno (las escribe la sync de Infisical prod /replica-r2 en el
# servicio replica-r2-prod de Railway, ver docs/runbooks/respaldo-y-restauracion.md):
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  usuario IAM bistrolink-replica-r2
#                                             (solo ListBucket y GetObject)
#   AWS_REGION                                us-east-2
#   S3_BUCKET_BACKUPS, S3_BUCKET_CFE          buckets de origen en S3
#   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY    token de R2 bistrolink-replica-prod
#                                             (Object Read & Write, solo los dos buckets)
#   R2_ENDPOINT                               https://<cuenta>.r2.cloudflarestorage.com
#   R2_BUCKET_BACKUPS, R2_BUCKET_CFE          buckets de destino en R2
#   REPLICA_ENVIRONMENT                       (opcional) para los logs. Default: prod.
#
# Qué hace:
#   1. rclone copy de cada bucket: sube a R2 lo que falta o cambió. Nunca
#      borra en R2 (copy, no sync): un borrado en S3 no se propaga.
#      - CFE: con --immutable, nunca reemplaza un objeto que ya está. Un CFE no
#        cambia después de emitirse; si cambiara en S3, la ejecución falla y
#        la copia de R2 queda intacta.
#      - Respaldos: compara por checksum y sí reemplaza. db-backup reescribe el
#        dump del día si se lo vuelve a ejecutar a mano («Run now» en Railway),
#        y la réplica tiene que quedar con el último.
#   2. rclone check --one-way: todo objeto de S3 tiene que estar igual en R2.
#      Si falta uno o es distinto, la ejecución falla.
#   3. Escribe en R2 la marca _replica/estado.json con la fecha de la última
#      réplica correcta. db-backup-check.yml (GitHub) la usa para avisar si la
#      réplica se atrasa.
#
# Reglas de seguridad:
#   - Nunca imprime credenciales: rclone las toma de variables de entorno y el
#     script no las muestra.
#   - Falla ante cualquier error (set -Eeuo pipefail): una réplica parcial no
#     se reporta como correcta.
set -Eeuo pipefail

log() { printf '%s level=%s entorno=%s %s\n' "$(date -u +%FT%TZ)" "$1" "${REPLICA_ENVIRONMENT:-prod}" "$2"; }
fail() { log error "$1"; exit 1; }
trap 'fail "falló el paso en la línea $LINENO"' ERR

for var in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION S3_BUCKET_BACKUPS S3_BUCKET_CFE \
           R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ENDPOINT R2_BUCKET_BACKUPS R2_BUCKET_CFE; do
  [ -n "${!var:-}" ] || fail "falta la variable de entorno $var"
done

# Remotos de rclone por variables de entorno (sin archivo de configuración).
export RCLONE_CONFIG=/dev/null
export RCLONE_CONFIG_S3_TYPE=s3
export RCLONE_CONFIG_S3_PROVIDER=AWS
export RCLONE_CONFIG_S3_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
export RCLONE_CONFIG_S3_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_S3_REGION="$AWS_REGION"

export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
# El token de R2 está limitado a los dos buckets: no puede crearlos ni
# consultarlos como bucket, solo leer y escribir objetos.
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

# Opciones comunes: reintentos ante errores de red y un resumen al final, sin
# listar cada objeto (las claves de los CFE llevan el id del establecimiento).
OPCIONES=(--retries 3 --low-level-retries 5 --log-level NOTICE --stats 0 --stats-log-level NOTICE)

replicar() {
  # replicar <nombre> <bucket S3> <bucket R2> <modo: inmutable | checksum>
  local nombre="$1" origen="s3:$2" destino="r2:$3" modo="$4" inicio fin
  # --immutable solo tiene sentido al copiar; el check compara igual.
  local copiar=() verificar=()
  if [ "$modo" = "inmutable" ]; then
    copiar=(--immutable --size-only)
    verificar=(--size-only)
  else
    copiar=(--checksum)
    verificar=()
  fi
  inicio="$(date +%s)"
  log info "bucket=$nombre modo=$modo copiando s3://$2 → r2://$3"
  rclone copy "$origen" "$destino" "${copiar[@]}" --exclude "_replica/**" "${OPCIONES[@]}"
  rclone check "$origen" "$destino" --one-way "${verificar[@]}" --exclude "_replica/**" "${OPCIONES[@]}"
  fin="$(date +%s)"
  log info "bucket=$nombre resultado=ok segundos=$((fin - inicio))"
}

log info "inicio de la réplica a R2"
replicar "backups" "$S3_BUCKET_BACKUPS" "$R2_BUCKET_BACKUPS" checksum
replicar "cfe"     "$S3_BUCKET_CFE"     "$R2_BUCKET_CFE"     inmutable

# Marca de la última réplica correcta (la lee db-backup-check.yml).
printf '{"ultima_replica":"%s","buckets":["%s","%s"]}\n' \
  "$(date -u +%FT%TZ)" "$S3_BUCKET_BACKUPS" "$S3_BUCKET_CFE" \
  | rclone rcat "r2:$R2_BUCKET_BACKUPS/_replica/estado.json" "${OPCIONES[@]}"

log info "réplica completa: 2 de 2 buckets"
