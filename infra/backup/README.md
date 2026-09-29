# Servicio de respaldo de bases de datos

Servicio programado (cron) de Railway que respalda `bistrolink-db` y `keycloak-db` en Amazon S3 todos los días. Implementa HU-029 (BL-183).

- **Por qué corre en Railway y no en GitHub Actions:** para que las bases no tengan que exponerse a internet. El servicio usa la red privada del proyecto de Railway.
- **Cómo se configura, se opera y se restaura:** [`docs/runbooks/respaldo-y-restauracion.md`](../../docs/runbooks/respaldo-y-restauracion.md).
- **Configuración de AWS** (buckets, reglas de ciclo de vida y usuario IAM): Anexo 12 de la documentación del proyecto, secciones 4, 5 y 6.

| Archivo | Contenido |
|---|---|
| `Dockerfile` | Imagen `postgres:17-alpine` + `aws-cli`, no-root, sin puertos expuestos |
| `backup.sh` | `pg_dump` → validación → SHA-256 → subida a S3 → verificación del objeto |

Prueba local, sin subir nada, para revisar solo que el script arranque y valide variables:

```bash
docker build -t bistrolink-backup infra/backup
docker run --rm bistrolink-backup   # falla con "falta la variable de entorno BACKUP_ENVIRONMENT"
```