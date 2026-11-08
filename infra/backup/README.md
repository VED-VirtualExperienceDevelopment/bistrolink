<p align="center">
  <img src="../../docs/assets/banner-backup.svg" alt="BistroLink · Respaldos" width="100%">
</p>

<p align="center">
  <a href="../../README.md">← BistroLink</a> ·
  <img src="https://img.shields.io/badge/PostgreSQL-381e72?logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/cron-diario-c9a74d" alt="cron diario">
</p>

## Servicio de respaldo de bases de datos

Servicio programado (cron) que respalda todos los días la base de negocio y la de Keycloak en un almacenamiento externo. Implementa HU-029 (BL-183).

- **Por qué corre junto a las bases y no en GitHub Actions:** para que las bases no tengan que exponerse a internet. El servicio usa la red privada del proyecto.
- **Cómo se configura, se opera y se restaura:** [`docs/runbooks/respaldo-y-restauracion.md`](../../docs/runbooks/respaldo-y-restauracion.md).
- **Controles automáticos:** `db-backup-check.yml` (todos los días, que exista el respaldo del día) y `db-backup-restore-test.yml` (todos los meses, prueba de restauración).

| Archivo      | Contenido                                                               |
| ------------ | ----------------------------------------------------------------------- |
| `Dockerfile` | Imagen `postgres:18-alpine` + `aws-cli`, no-root, sin puertos expuestos |
| `backup.sh`  | `pg_dump` → validación → SHA-256 → subida → verificación del objeto     |

Prueba local, sin subir nada, para revisar solo que el script arranque y valide variables:

```bash
docker build -t bistrolink-backup infra/backup
docker run --rm bistrolink-backup   # falla con "falta la variable de entorno BACKUP_ENVIRONMENT"
```
