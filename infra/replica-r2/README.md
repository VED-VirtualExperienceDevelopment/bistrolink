<p align="center">
  <a href="../../README.md">← BistroLink</a> ·
  <img src="https://img.shields.io/badge/Cloudflare_R2-381e72?logo=cloudflare&logoColor=white" alt="Cloudflare R2">
  <img src="https://img.shields.io/badge/cron-cada_hora-c9a74d" alt="cron cada hora">
</p>

## Réplica de respaldos y CFE en Cloudflare R2

Servicio programado (cron) que copia cada hora a Cloudflare R2 los respaldos de las bases y los PDF de los CFE de producción. Completa la regla 3-2-1 con una copia fuera de Amazon. Implementa HU-030 (BL-184).

- **Qué copia:** `bistrolink-backups-prod` y `bistrolink-cfe-prod` (S3) a sus réplicas en R2. Solo producción.
- **Cómo:** `rclone copy`, nunca `sync`: un borrado en S3 no se propaga a R2. Con `--immutable`, un objeto que ya está en R2 no se reemplaza.
- **Credenciales de mínimo privilegio:** en S3, un usuario de IAM que solo lista y lee (no puede modificar ni borrar los originales). En R2, un token limitado a los dos buckets de réplica.
- **Cómo se configura, se controla y se restaura:** [`docs/runbooks/respaldo-y-restauracion.md`](../../docs/runbooks/respaldo-y-restauracion.md), sección 9.

| Archivo      | Contenido                                                                           |
| ------------ | ----------------------------------------------------------------------------------- |
| `Dockerfile` | Imagen `alpine` + `rclone`, no-root, sin puertos expuestos                          |
| `replica.sh` | `rclone copy` → `rclone check` → marca `_replica/estado.json` con la última réplica |

Prueba local, sin copiar nada, para revisar solo que el script arranque y valide variables:

```bash
docker build -t bistrolink-replica-r2 infra/replica-r2
docker run --rm bistrolink-replica-r2   # falla con "falta la variable de entorno AWS_ACCESS_KEY_ID"
```
