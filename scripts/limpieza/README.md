# Limpieza de datos de prueba (local y staging)

BL-478 (BL-285, [ADR 0011](../../docs/adr/0011-limpieza-de-datos-de-prueba.md)). `limpiar-entorno.mjs` deja los datos de prueba como el seed: antes de una demo, después de una corrida de E2E en tu PC o todas las noches en staging.

| Qué                                   | Cómo queda                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Pedidos abiertos de los tenants A y B | Sin pagar → CANCELADO; pagados → ENTREGADO. **No se borran** (tienen CFE).                     |
| Mesas y plano                         | Mesas 1 y 2 del seed abiertas; mesas temporales (50 a 99) y zonas «Zona E2E …» fuera.          |
| Carta y stock                         | Ítems y categorías «E2E …» fuera (archivados si tienen pedidos); los del seed con sus valores. |
| Configuración del establecimiento     | Como el seed (no toca el correo de privacidad ni el RUT).                                      |
| Usuarios «e2e-…»                      | Borrados, o desactivados si tienen historial.                                                  |
| Establecimientos «E2E Plataforma …»   | Borrados, o suspendidos si tienen pedidos. Los tenants A y B nunca.                            |

Se usa la API (`POST /testing/limpieza` y `POST /testing/limpieza/establecimientos`), no la base: cada cambio queda en la auditoría y llega en vivo al KDS y a la carta. Las rutas solo existen con **`E2E_CLEANUP_ENABLED=true`** en el backend; sin eso responden 404.

**Siempre arranca en simulación (dry-run).** Muestra qué cambiaría y no toca nada. Para aplicar, se agrega `--aplicar`.

## En tu PC (base local)

1. En `apps/backend/.env`, sin comillas ni espacios, y reiniciá el backend:

   ```dotenv
   E2E_CLEANUP_ENABLED=true
   ```

2. Con el backend y Keycloak levantados:

   ```powershell
   npm run limpiar:local                 # simulación
   npm run limpiar:local -- --aplicar    # aplica
   ```

En local el script toma de `apps/backend/.env` el Keycloak (`KEYCLOAK_URL`, `KEYCLOAK_CLIENT_SECRET`) y los usuarios de prueba (`TEST_ADMIN_*`, `TEST_TENANT_B_*`), los mismos que carga `keycloak/test-users.json`. Las variables de la sesión mandan sobre el archivo. Por defecto cierra **todos** los pedidos abiertos (`--antiguedad-horas 0`).

El usuario de plataforma no está en el Keycloak local por defecto. Si lo creaste (ver `e2e/README.md`, BL-416), cargá en la sesión `TEST_PLATAFORMA_USERNAME`, `TEST_PLATAFORMA_PASSWORD` y `TEST_PLATAFORMA_OTP_SECRET`. Si faltan, ese paso se saltea con un aviso.

## En staging

**Desde GitHub (lo normal):** Actions → **Limpieza de staging** → **Run workflow**.

| Input              | Por defecto | Para una demo |
| ------------------ | ----------- | ------------- |
| `dry_run`          | tildado     | destildado    |
| `antiguedad_horas` | `24`        | `0`           |

Conviene correrlo primero con `dry_run` tildado y revisar el resumen de la corrida. Todas las noches (06:13 UTC) corre solo, aplicando, con pedidos de más de 24 h.

**Desde tu PC:** con las mismas variables que el workflow cargadas en la sesión (nunca en un archivo):

```powershell
$env:KEYCLOAK_CLIENT_SECRET = [System.Net.NetworkCredential]::new('', (Read-Host "Client secret de staging" -AsSecureString)).Password
# ...igual con TEST_ADMIN_*, TEST_TENANT_B_* y TEST_PLATAFORMA_*
npm run limpiar:staging
npm run limpiar:staging -- --aplicar --antiguedad-horas 0
Remove-Item Env:KEYCLOAK_CLIENT_SECRET, Env:TEST_*_PASSWORD, Env:TEST_PLATAFORMA_OTP_SECRET
```

⚠️ **No limpies staging mientras corren los E2E:** les saca las mesas, ítems y usuarios que están usando.

## Opciones

| Opción                 | Qué hace                                                  |
| ---------------------- | --------------------------------------------------------- |
| `--entorno local`      | Por defecto. `http://localhost:3001` y el Keycloak local. |
| `--entorno staging`    | La API y el Keycloak de staging. No existe otro entorno.  |
| `--aplicar`            | Hace los cambios. Sin esto, simula.                       |
| `--antiguedad-horas N` | Pedidos abiertos con más de N horas (0 a 720; 0 = todos). |
| `--ayuda`              | Ayuda.                                                    |

Variables opcionales: `API_URL`, `KEYCLOAK_URL`, `KEYCLOAK_REALM` (`bistrolink`), `KEYCLOAK_CLIENT_ID` (`bistrolink-backend`). El script se niega a correr si `API_URL` apunta a producción.

**Resultado:** una tabla por tenant y área en la consola (y en el resumen de la corrida en Actions). Termina con código 1 si algo no se pudo limpiar (sin token, sin conexión, 404). Lo que conviene revisar sin cortar la corrida (usuarios o establecimientos con error, cuentas de Keycloak pendientes) sale como aviso.

## Tests

```powershell
npm run test:limpieza
```

Sin dependencias (`node:test`). Keycloak y la API se reemplazan por un servidor local. El workflow los corre antes de limpiar.
