# Runbook: contingencia de producción en Render

> **Ticket:** BL-217 (EDT 1.2.11, riesgo R-03) · **Relacionado:** BL-183 y BL-184 (respaldo en S3 y réplica en R2), BL-227 (Infisical), BL-240 (producción con integraciones en sandbox), BL-261 (respuesta a incidentes) · **Documentación del proyecto:** Línea de Base, 3.3.6.

## Control de versiones

| Versión | Fecha      | Cambio |
| ------- | ---------- | ------ |
| 1.0     | 21/11/2026 | Primera versión: preparación, activación con restauración desde S3 o R2, validación, vuelta a Railway, simulacro con RTO y RPO, y mantenimiento con cada release. |
| 1.1     | 22/11/2026 | Correcciones de la primera prueba completa (3.6): carpeta de trabajo fuera de la carpeta del usuario; credenciales de solo lectura para bajar el respaldo; sufijo que Render agrega al nombre de la base; regla de IP solo en la base; SQL por la entrada estándar en PowerShell; verificación de la restauración sin pasar por el RLS; primer deploy de Keycloak; `-UseBasicParsing`; validación con un usuario temporal si producción no tiene usuarios; copia de `tiempos.txt` al Escritorio real; ajustes de la preparación (3.4 y 3.5) y problemas nuevos en la sección 8. Se quitan del documento la ubicación de las credenciales dentro del gestor de secretos, el tipo de cuenta y el gestor de contraseñas del equipo: el repositorio es público. |
| 1.2     | 24/11/2026 | Sección 7: el PR de `render.yaml` con el tag nuevo lo abre el pipeline después de cada release final (BL-619); qué revisar antes del merge y cómo abrirlo a mano si no aparece. Se quitan los nombres del token de GHCR, de la clave de Render y de la conexión de Infisical, la mención del gestor de contraseñas y la ruta local del clon: el repositorio es público (BL-610). |

## 1. Para qué sirve

Si Railway no está disponible, producción se levanta en **Render** con las mismas imágenes y el último respaldo de las bases.

- **Modelo:** contingencia pasiva. API, Keycloak y Web quedan **creados, probados y suspendidos**. Render no cobra un servicio suspendido. La base **no** existe en reposo: se crea al activar y se restaura el último respaldo.
- **Objetivos (Línea de Base, 3.3.6):** **RPO ≤ 24 h** (respaldo diario de las 03:00 de Uruguay) y **RTO ≤ 4 h**. Los valores reales se miden en el simulacro (sección 6).
- **Quién decide activarla:** el equipo, con el procedimiento de respuesta a incidentes (`respuesta-a-incidentes.md`). Se activa si Railway está caído y su página de estado no da un horario de vuelta, o si lo da a más de 1 hora. Mientras se decide, el local sigue con el modo degradado de R-03 (pedido al mozo y cobro manual).
- **Qué no cubre:** la pérdida de datos entre el último respaldo y la caída (hasta 24 h). Los datos de ese período quedan en Railway y se revisan al volver (5.2).

## 2. Cómo queda armado

Proyecto de Render **`bistrolink-contingencia`**, entorno `production`, región **Ohio** (la misma costa que S3, `us-east-2`). Todo está declarado en `render.yaml`, en la raíz del repositorio, salvo la base.

| Servicio | Origen | Instancia | URL pública | Health check |
| -------- | ------ | --------- | ----------- | ------------ |
| `bistrolink-api-contingencia` | Imagen de GHCR, tag de producción (`vX.Y.Z`), con el *pre-deploy* de migraciones | Starter (0,5 CPU · 512 MB) | `https://bistrolink-api-contingencia.onrender.com` | `/health/ready` |
| `bistrolink-auth-contingencia` | Imagen de GHCR, tag de producción | Standard (1 CPU · 2 GB) | `https://bistrolink-auth-contingencia.onrender.com` | `/realms/bistrolink/.well-known/openid-configuration` |
| `bistrolink-web-contingencia` | Build en Render desde `main` (`apps/frontend/Dockerfile`), con las URLs de Render | Starter | `https://bistrolink-web-contingencia.onrender.com` | `/api/health` |
| `bistrolink-contingencia-db` | **Se crea al activar.** PostgreSQL 18, con las bases `bistrolink` y `keycloak` | Basic 256 MB · 1 GB de disco | Sin acceso público en uso | — |

- **Credenciales:** desde Infisical, las mismas de producción, con una sincronización por servicio (3.4). El repositorio no tiene ningún secreto.
- **Variables de conexión a la base:** se cargan a mano en Render al activar, porque la base es nueva cada vez. No se guardan en ningún otro lado: la base se borra al terminar.
- **Costo:** unos USD 45 por mes con la contingencia activa, prorrateado por segundo (USD 1,5 por día). En reposo, USD 0.

## 3. Preparación (una sola vez)

### 3.1 Requisitos

- Cuenta de Render del proyecto, con una **tarjeta** cargada: las instancias gratuitas no sirven (Keycloak no arranca en 512 MB y los servicios gratuitos se duermen y cortan el WebSocket del KDS).
- En la PC de quien ejecuta: **Docker Desktop** (se usan las imágenes `postgres:18` y `amazon/aws-cli`, sin instalar nada más) y **PowerShell**.
- Acceso a las credenciales de producción en Infisical y a la consola de Railway `production` (solo para leer nombres y configuración no secreta).

### 3.2 Credencial de GHCR

Las imágenes de GHCR son privadas.

1. En GitHub, con la cuenta del equipo: *Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token*. Con un nombre que indique su uso, solo **`read:packages`**, con vencimiento. Es un token aparte del de Railway, para poder revocar uno sin tocar el otro.
2. Guardar el valor en Infisical, junto a las credenciales de producción, sin sincronización.
3. En Render: *Workspace Settings → Registry Credentials → Add Credential*.
   - **Registry:** GitHub.
   - **Name:** **`ghcr-bistrolink`** (el nombre que usa `render.yaml`).
   - **Username:** el usuario de la cuenta del equipo.
   - **Personal Access Token:** el token del paso 1.

### 3.3 Crear el Blueprint

1. Si existe un proyecto vacío `bistrolink-contingencia` creado a mano, borrarlo: lo crea el Blueprint.
2. Render → **New → Blueprint** → conectar el repositorio `VED-VirtualExperienceDevelopment/bistrolink`.
   - **Branch:** la rama por defecto del repositorio (hoy `develop`). Ahí está `render.yaml`. La Web se compila igual desde `main`, porque su servicio lo fija con `branch: main`.
   - **Blueprint Name:** `bistrolink-contingencia`.
3. **Apply.** Render crea los tres servicios e intenta desplegarlos. **Es esperable que API y Auth fallen** en este primer deploy: todavía no tienen la base ni los secretos.
4. **Revisar las URLs.** En cada servicio, la URL de arriba tiene que ser exactamente la de la tabla de la sección 2. Si Render agregó un sufijo (por ejemplo, `bistrolink-api-contingencia-x1y2.onrender.com`), corregir las URLs de `render.yaml` en un PR y sincronizar el Blueprint (*Manual Sync*) antes de seguir.

### 3.4 Credenciales desde Infisical

1. En Render: *Account Settings → API Keys → Create API Key*, con un nombre que indique su uso, **limitada al workspace del proyecto** y con los permisos mínimos: *Services* en lectura y *Environment variables* en lectura y escritura. No se guarda en ningún otro lugar que no sea la conexión del paso 2.
2. Infisical → *Organization → App Connections → Add Connection → Render*, con la clave del paso 1.
3. Infisical → proyecto `bistrolink` → *Integrations → Secret Syncs → Add Sync → Render*. Crear dos:

   | Sync | Origen | Destino | Opciones |
   | ---- | ------ | ------- | -------- |
   | `render-prod-api` | Credenciales de la API de producción | Servicio `bistrolink-api-contingencia` | *Overwrite destination*; **Prevent secret deletion** activado; **Auto-sync desactivado**; sin redeploy automático |
   | `render-prod-auth` | Credenciales de Keycloak de producción | Servicio `bistrolink-auth-contingencia` | Ídem |

   **Por qué sin Auto-sync:** si `prod` tuviera una variable de conexión a la base (por ejemplo, `RUNTIME_DATABASE_URL` con el host de Railway), cada sincronización pisaría el valor de Render. Con la sincronización manual, el orden lo fija el runbook: primero *Sync now* y después las variables de la base (4.5).

4. *Trigger Sync* en las dos. En Render, *Environment* de cada servicio: tienen que aparecer las credenciales sincronizadas, además de las de `render.yaml`. Las credenciales sincronizadas **no** incluyen las variables de conexión a la base: una sincronización nunca las pisa (4.5).

### 3.5 Configuración copiada de Railway

Hay configuración no secreta de Railway que no está en Infisical ni en `render.yaml`.

1. En Railway `production`, abrir las variables de `bistrolink-api` y de `bistrolink-auth` y mirar **solo los nombres**.
2. Para cada nombre que falte en el servicio de Render equivalente, decidir:
   - **Agregar a mano** en Render: configuración que el código usa y no apunta a Railway. Como mínimo, `IMAGES_CDN_URL`. Lo que llega por la sincronización no se copia.
   - **No agregar:** `DATABASE_URL`, `RUNTIME_DATABASE_URL` y `KC_DB_*` (se cargan al activar), variables que nombran servicios de Railway (`${{…}}`) y las que el código no usa. Las de los logs llegan por la sincronización: los logs de la API de Render van al mismo destino que los de producción.
3. En `bistrolink-web-contingencia`, agregar `NEXT_PUBLIC_MP_PUBLIC_KEY` con la Public Key de la aplicación de prueba de producción (la variable del repositorio `MP_PUBLIC_KEY_PRODUCTION`). No es secreta, pero se lee en el build: sin ella, el pago con tarjeta queda deshabilitado. **Si la Public Key cambia, hay que actualizarla en los dos lugares:** la variable del repositorio y este servicio.

### 3.6 Primera prueba

Ejecutar la sección 4 completa, de punta a punta. Esta corrida **no** cuenta como simulacro: incluye el tiempo de armar todo por primera vez. Sirve para encontrar los problemas antes del simulacro (sección 8).

### 3.7 Dejar en reposo

1. Hacer el cierre de la sección 5.1 (suspender los servicios y borrar la base).
2. Registrar la preparación en el ticket de Linear (BL-217): fecha, tag desplegado y resultado.

## 4. Activación

> Cada paso empieza con una **marca de tiempo** (`Marca`). El archivo `tiempos.txt` es la evidencia del RTO; no tiene ningún secreto.
> Los valores secretos se pegan en PowerShell con `Set-Secreto`: no se muestran en pantalla ni quedan en el historial. **Nunca** se pegan en chats, tickets ni capturas.

### 4.1 Arrancar

En PowerShell, en una carpeta **fuera de cualquier repositorio de git** (los respaldos tienen datos de producción). Se usa `C:\contingencia` y no la carpeta del usuario, porque esa carpeta puede estar dentro de un repositorio (por ejemplo, uno de archivos de configuración): comprobar que el prompt **no** muestre una rama de git.

```powershell
$dir = "C:\contingencia\contingencia-$(Get-Date -Format yyyyMMdd-HHmm)"
New-Item -ItemType Directory -Force $dir | Out-Null
Set-Location $dir

# Ruta de los scripts SQL en el clon del repositorio (ajustar si hace falta).
$sql = "C:\\ruta\\del\\clon\\bistrolink\\infra\\contingencia-render"   # cambiar por la carpeta del clon

function Marca([string]$Paso) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`t$Paso" | Tee-Object -FilePath "$dir\tiempos.txt" -Append
}
function Set-Secreto([string]$Nombre) {
  $s = Read-Host "Pegá $Nombre (no se muestra)" -AsSecureString
  Set-Item "env:$Nombre" ([System.Net.NetworkCredential]::new('', $s).Password)
}

Marca "T0 - inicio de la activacion (caida declarada)"
```

### 4.2 Bajar y verificar el respaldo

**Desde S3** (lo normal). Con las credenciales de AWS **de solo lectura** de los respaldos de producción (Infisical). Las del servicio que genera los respaldos no sirven para esto: no pueden listar el bucket.

```powershell
Marca "4.2 bajar respaldo"
Set-Secreto AWS_ACCESS_KEY_ID
Set-Secreto AWS_SECRET_ACCESS_KEY
$env:AWS_DEFAULT_REGION = "us-east-2"
$bucket = "bistrolink-backups-prod"

# Ver el último respaldo (la hora es UTC). Cambiar el año y el mes si hace falta.
docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION amazon/aws-cli s3 ls "s3://$bucket/daily/bistrolink-db/2026/11/"
```

Anotar la **fecha** del último `.dump` y su **hora** (columna de la izquierda, en UTC): es el punto de recuperación para el RPO.

```powershell
$fecha = "2026-11-25"   # la fecha del último respaldo
$anio = $fecha.Substring(0,4); $mes = $fecha.Substring(5,2)
foreach ($base in "bistrolink-db","keycloak-db") {
  foreach ($ext in "dump","sha256") {
    docker run --rm -v "${dir}:/aws" -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION amazon/aws-cli `
      s3 cp "s3://$bucket/daily/$base/$anio/$mes/$fecha.$ext" "/aws/$base.$ext"
  }
}

# Verificar el SHA-256 de cada dump: las dos líneas tienen que decir OK.
foreach ($base in "bistrolink-db","keycloak-db") {
  $esperado = ((Get-Content "$base.sha256" -Raw).Trim() -split '\s+')[0]
  $real = (Get-FileHash "$base.dump" -Algorithm SHA256).Hash.ToLower()
  if ($esperado -eq $real) { "$base OK" } else { "$base NO COINCIDE: no usar este respaldo" }
}
Remove-Item env:AWS_ACCESS_KEY_ID, env:AWS_SECRET_ACCESS_KEY
Marca "4.2 respaldo verificado ($fecha)"
```

**Desde R2** (si S3 no está disponible). Mismo procedimiento, con el token de lectura de R2 y su endpoint, de Infisical (`respaldo-y-restauracion.md`, 9.6):

```powershell
Set-Secreto AWS_ACCESS_KEY_ID        # access key del token de R2
Set-Secreto AWS_SECRET_ACCESS_KEY    # secret del token de R2
Set-Secreto R2_ENDPOINT
$env:AWS_DEFAULT_REGION = "auto"
$bucket = "bistrolink-backups-prod-replica"
# En los comandos de arriba, agregar al final de cada "s3 ls" y "s3 cp":
#   --endpoint-url $env:R2_ENDPOINT
```

### 4.3 Crear la base en Render

```powershell
Marca "4.3 crear base en Render"
```

Render → proyecto `bistrolink-contingencia`, entorno `production` → **New → Postgres**:

| Campo | Valor |
| ----- | ----- |
| Name | `bistrolink-contingencia-db` |
| Database | `bistrolink` |
| User | `bistrolink_user` |
| Region | **Ohio** (la misma que los servicios: si no, no se ven por la red privada) |
| PostgreSQL Version | **18** (la de Railway; la restauración necesita la misma versión mayor o una más nueva) |
| Plan | Basic 256 MB, 1 GB de disco |

Para que la base quede dentro del proyecto, crearla con el **+ New** que está debajo de la lista de servicios del entorno, no con el de la barra de arriba.

Cuando quede *Available*:

1. **Acceso solo desde la IP de quien restaura.** En *Info*, sección *Networking*, hay tres bloques de reglas: el del workspace, el del entorno y **PostgreSQL Inbound IP Rules**. **Solo se cambia el último**: los otros dos también afectan a la API, la Web y Keycloak, que tienen que ser públicos. Reemplazar `0.0.0.0/0` por la IP propia con `/32` (se obtiene con `Invoke-RestMethod "https://api.ipify.org"`) y guardar. Se quita al terminar la restauración (4.4).
2. *Connect → External*: copiar la **External Database URL** completa. El **host interno** es el *Service ID* de la base (`dpg-…-a`), que no es secreto.
3. **Render agrega un sufijo al nombre de la base** (`/bistrolink_xxxx`), aunque se escriba `bistrolink`. Se crea la base `bistrolink` en la misma instancia y se usa esa, para que los nombres del resto del runbook no cambien.

```powershell
Set-Secreto RENDER_DB_URL            # la External Database URL
$hostInterno = "dpg-XXXXXXXX-a"      # el Service ID de la base

# Crear la base "bistrolink". El SQL va por la entrada estándar: PowerShell
# quita las comillas internas de un psql -c "..." con espacios.
"CREATE DATABASE bistrolink;" | docker run --rm -i -e RENDER_DB_URL postgres:18 sh -c 'psql $RENDER_DB_URL'

$env:RENDER_DB_URL = $env:RENDER_DB_URL -replace '/[^/?]+$', '/bistrolink'
$env:RENDER_KC_URL = $env:RENDER_DB_URL -replace '/bistrolink$', '/keycloak'
$env:RENDER_DB_URL -match '/bistrolink$'   # tiene que dar True
Marca "4.3 base disponible"
```

### 4.4 Restaurar las dos bases

```powershell
Marca "4.4 restaurar"

# Contraseña nueva para el rol de la API, solo para esta base.
$b = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$env:APP_DB_PASSWORD = ($b | ForEach-Object { $_.ToString('x2') }) -join ''

# 1. Rol de la API y base de Keycloak.
docker run --rm -v "${sql}:/sql" -e RENDER_DB_URL -e APP_DB_PASSWORD postgres:18 `
  sh -c 'psql "$RENDER_DB_URL" -f /sql/01-preparar-base.sql'

# 2. Datos de negocio.
docker run --rm -v "${dir}:/trabajo" -e RENDER_DB_URL postgres:18 `
  sh -c 'pg_restore --no-owner --no-acl --exit-on-error --dbname="$RENDER_DB_URL" /trabajo/bistrolink-db.dump'
Marca "4.4 bistrolink-db restaurada"

# 3. Permisos del rol de la API.
docker run --rm -v "${sql}:/sql" -e RENDER_DB_URL postgres:18 `
  sh -c 'psql "$RENDER_DB_URL" -f /sql/02-permisos-app.sql'

# 4. Keycloak.
docker run --rm -v "${dir}:/trabajo" -e RENDER_KC_URL postgres:18 `
  sh -c 'pg_restore --no-owner --no-acl --exit-on-error --dbname="$RENDER_KC_URL" /trabajo/keycloak-db.dump'
Marca "4.4 keycloak-db restaurada"

# 5. Verificaciones.
docker run --rm -v "${sql}:/sql" -e RENDER_DB_URL postgres:18 `
  sh -c 'psql "$RENDER_DB_URL" -f /sql/03-verificar-restauracion.sql'
$env:APP_URL = $env:RENDER_DB_URL -replace '//[^@]+@', "//bistrolink_app:$($env:APP_DB_PASSWORD)@"
docker run --rm -v "${sql}:/sql" -e APP_URL postgres:18 `
  sh -c 'psql "$APP_URL" -f /sql/04-verificar-rls.sql'
Marca "4.4 verificaciones OK"
```

Resultado esperado:

- `01`: `bistrolink_app` con `rolsuper = f` y `rolbypassrls = f`.
- `03`: la última migración; el tamaño y las filas de cada tabla; las tablas con RLS activo y forzado (todas menos `_prisma_migrations` y alguna de configuración global); las políticas, y los dos roles sin superusuario ni bypass de RLS. Las filas salen de las estadísticas de PostgreSQL y no de un `count(*)`: en Render el dueño de las tablas (`bistrolink_user`) no es superusuario, y el RLS forzado también se le aplica.
- `04`: `current_user = bistrolink_app` y **`pedidos_visibles = 0`**. Si da más de 0, **no seguir**: el RLS no se está aplicando (sección 8). **El resultado solo prueba el aislamiento si `03` mostró filas en `pedido`:** con la tabla vacía también da 0.

Después, en Render, *Info → Networking → PostgreSQL Inbound IP Rules* de la base: **borrar la IP**. El bloque queda vacío y la base, accesible solo por la red privada.

```powershell
Marca "4.4 acceso externo cerrado"
```

### 4.5 Variables de conexión

```powershell
Marca "4.5 variables de conexion"
$pwRender = ([uri]$env:RENDER_DB_URL).UserInfo.Split(':')[1]   # $hostInterno es el de 4.3
```

1. Infisical: *Trigger Sync* en `render-prod-api` y `render-prod-auth`. Va primero, para que no pise las variables de los pasos siguientes (3.4).
2. **`bistrolink-api-contingencia` → Environment.** Cada valor se copia al portapapeles con el comando y se pega en Render; no se muestra.

   | Variable | Comando para copiar el valor |
   | -------- | ---------------------------- |
   | `DATABASE_URL` | `"postgresql://bistrolink_user:$pwRender@${hostInterno}:5432/bistrolink" \| Set-Clipboard` |
   | `RUNTIME_DATABASE_URL` | `"postgresql://bistrolink_app:$($env:APP_DB_PASSWORD)@${hostInterno}:5432/bistrolink" \| Set-Clipboard` |

   Guardar con **Save only**, sin desplegar: el servicio está suspendido y se reanuda en 4.7. No usar el ícono del ojo para «revisar» un valor: lo muestra en pantalla.

3. **`bistrolink-auth-contingencia` → Environment:**

   | Variable | Valor |
   | -------- | ----- |
   | `KC_DB_URL` | `jdbc:postgresql://dpg-XXXXXXXX-a:5432/keycloak` (con el host interno) |
   | `KC_DB_USERNAME` | `bistrolink_user` |
   | `KC_DB_PASSWORD` | `$pwRender \| Set-Clipboard` |

4. Limpiar el portapapeles: `Set-Clipboard -Value " "`.

### 4.6 Keycloak

```powershell
Marca "4.6 reanudar Keycloak"
```

1. **Verificar el tag:** *Settings → Image* tiene que tener el tag que está en producción (el último GitHub Release). Si no coincide, cambiarlo (sección 7).
2. **Resume Service.** Si en *Events* no aparece un deploy nuevo con las variables de 4.5, *Manual Deploy → Deploy latest reference*. En la primera activación Keycloak no tiene ningún deploy previo, así que este paso hace falta siempre.
3. En *Logs*, esperar a que `set-client-secret.sh` termine. Tienen que aparecer la línea del client secret y la de «Protección contra fuerza bruta en bistrolink activa (BL-582)». El servicio queda *Live* cuando responde el health check.
4. **Comprobar el `issuer`** desde PowerShell: tiene que ser la URL de Render.

   ```powershell
   Invoke-RestMethod "https://bistrolink-auth-contingencia.onrender.com/realms/bistrolink/.well-known/openid-configuration" | Select-Object issuer
   ```

5. **URLs del cliente del frontend.** La base restaurada tiene las URLs de Railway: hay que sumar la de Render. En el servicio → **Shell**:

   ```bash
   cd /opt/keycloak/bin
   ./kcadm.sh config credentials --config /tmp/kcadm.config --server http://localhost:8080 \
     --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"
   ID=$(./kcadm.sh get clients --config /tmp/kcadm.config -r bistrolink -q clientId=bistrolink-frontend \
     --fields id --format csv --noquotes | tail -n1)
   ./kcadm.sh update "clients/$ID" --config /tmp/kcadm.config -r bistrolink \
     -s 'redirectUris=["https://bistrolink-web-production.up.railway.app/*","https://bistrolink-web-contingencia.onrender.com/*"]' \
     -s 'webOrigins=["https://bistrolink-web-production.up.railway.app","https://bistrolink-web-contingencia.onrender.com"]' \
     -s 'attributes."post.logout.redirect.uris"="https://bistrolink-web-production.up.railway.app/*##https://bistrolink-web-contingencia.onrender.com/*"'
   ./kcadm.sh get "clients/$ID" --config /tmp/kcadm.config -r bistrolink --fields redirectUris,webOrigins
   rm -f /tmp/kcadm.config
   ```

   El cambio queda solo en la base de Render: la de Railway no se toca. Al terminar, `ls /tmp/kcadm.config` tiene que dar *No such file or directory*.

```powershell
Marca "4.6 Keycloak listo"
```

### 4.7 API

```powershell
Marca "4.7 reanudar API"
```

1. Verificar el tag de la imagen, igual que en 4.6.
2. **Resume Service** (y *Manual Deploy* si no se desplegó con las variables nuevas).
3. En *Logs* del deploy: el *pre-deploy* tiene que mostrar `[predeploy] aplicando migraciones pendientes...` y terminar bien. Si el respaldo es de una versión anterior, aplica las migraciones que falten.

```powershell
$api = "https://bistrolink-api-contingencia.onrender.com"
Invoke-RestMethod "$api/health/ready"      # status ok, postgres available
Invoke-RestMethod "$api/health/version"    # el tag de producción y upToDate: true
Marca "4.7 API lista"
```

### 4.8 Web

```powershell
Marca "4.8 reanudar Web"
```

1. **Resume Service** y después *Manual Deploy → Deploy latest commit*. Compila el último commit de `main`, con las URLs de Render. Tarda varios minutos.
2. Verificar:

   ```powershell
   Invoke-WebRequest "https://bistrolink-web-contingencia.onrender.com/api/health" -UseBasicParsing | Select-Object StatusCode
   Marca "4.8 Web lista"
   ```

3. **Solo en una activación real** (en el simulacro, **no**):
   - En la API, pasar a `true` los procesos en segundo plano de `render.yaml` (`PAGOS_CONCILIACION_HABILITADA`, `CFE_*`, `POS_SINCRONIZACION_HABILITADA`, `REPORTES_RESUMEN_HABILITADO`, `COMPLEMENTOS_REGLAS_HABILITADO`) y redesplegar.
   - En la aplicación de prueba de producción de Mercado Pago, cambiar la URL de notificaciones al webhook de la API de Render.
   - Avisar a los establecimientos la URL de Render: los QR impresos apuntan a Railway. Los QR nuevos ya salen con la URL de Render (`FRONTEND_URL`).

### 4.9 Validación

```powershell
Marca "4.9 validacion"
Invoke-RestMethod "https://bistrolink-auth-contingencia.onrender.com/realms/bistrolink/.well-known/openid-configuration" | Select-Object issuer
```

El `issuer` tiene que ser la URL de Keycloak en Render. Después, en el navegador, con la URL de la Web de Render:

- [ ] Ingreso de un Administrador con su usuario de producción y `/admin/usuarios`.
- [ ] Ingreso de Cocina: el KDS muestra el indicador de conexión en verde (WebSocket).
- [ ] Menú del comensal en incógnito, con el link de una mesa cambiando el dominio por el de Render: carga la carta con imágenes y obtiene el token del comensal.
- [ ] En las herramientas del navegador (*Network*), las llamadas van a la API de Render y ninguna a Railway.
- [ ] **Simulacro:** sin pagos ni cobros. Un pago emitiría un CFE de sandbox y guardaría su PDF en el bucket de CFE de producción, con Object Lock de 5 años.

**Si producción no tiene usuarios todavía**, la validación del ingreso se hace con un usuario PLATAFORMA temporal, creado **solo en el Keycloak de Render** (desaparece al borrar la base en 5.1). En el servicio de Keycloak → **Shell**:

```bash
cd /opt/keycloak/bin
./kcadm.sh config credentials --config /tmp/kcadm.config --server http://localhost:8080 \
  --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"
./kcadm.sh create users --config /tmp/kcadm.config -r bistrolink \
  -s username=contingencia-prueba -s enabled=true -s emailVerified=true \
  -s firstName=Prueba -s lastName=Contingencia -s email=contingencia-prueba@example.invalid \
  -s 'requiredActions=["CONFIGURE_TOTP"]'
./kcadm.sh add-roles --config /tmp/kcadm.config -r bistrolink --uusername contingencia-prueba --rolename PLATAFORMA
read -s -p "Contraseña: " PW; echo
./kcadm.sh set-password --config /tmp/kcadm.config -r bistrolink --username contingencia-prueba --new-password "$PW"
unset PW
rm -f /tmp/kcadm.config
```

El ingreso pide configurar el OTP (el rol PLATAFORMA lo exige). Tiene que llegar a `/plataforma`. Al terminar, borrar esa entrada de la app de autenticación.

```powershell
Marca "T1 - fin de la validacion (servicio recuperado)"
```

## 5. Cierre

### 5.1 Fin del simulacro (o de la primera prueba)

1. En Render, **Suspend Service** en los tres servicios.
2. Borrar la base: `bistrolink-contingencia-db` → *Settings → Delete Database*. Es una copia: la de producción sigue en Railway.
3. En Infisical, nada: las sincronizaciones quedan para la próxima vez.
4. En la PC: guardar `tiempos.txt` con la evidencia y **borrar los respaldos**:

   ```powershell
   $destino = Join-Path ([Environment]::GetFolderPath('Desktop')) "tiempos-contingencia-$(Get-Date -Format yyyyMMdd).txt"
   Copy-Item "$dir\tiempos.txt" $destino
   Test-Path $destino                 # tiene que dar True antes de borrar la carpeta
   Remove-Item env:RENDER_DB_URL, env:RENDER_KC_URL, env:APP_DB_PASSWORD, env:APP_URL -ErrorAction SilentlyContinue
   Remove-Variable pwRender -ErrorAction SilentlyContinue
   Set-Location C:\
   Remove-Item -Recurse -Force $dir
   ```

   `GetFolderPath('Desktop')` da la ruta real del Escritorio, también cuando está en OneDrive. Si `tiempos.txt` se perdiera, los tiempos se recuperan de la misma ventana de PowerShell, antes de cerrarla:

   ```powershell
   Get-History | Where-Object CommandLine -like 'Marca*' | Select-Object @{n='Hora';e={$_.StartExecutionTime.ToString('HH:mm:ss')}}, CommandLine
   ```

### 5.2 Vuelta a Railway (después de una activación real)

Lo decide el equipo cuando Railway vuelve y está estable. Se hace en un horario sin uso.

1. Avisar la ventana de mantenimiento y suspender la API de Render (corta las escrituras).
2. Respaldar las dos bases de Render con el mismo formato del respaldo diario (`pg_dump --format=custom --compress=9 --no-owner --no-acl`), desde la PC y con la IP habilitada temporalmente, como en 4.3.
3. Restaurar en Railway sobre **servicios PostgreSQL nuevos** (`respaldo-y-restauracion.md`, sección 6), para conservar las bases originales intactas. Volver a crear los permisos de `bistrolink_app` como en Railway.
4. Apuntar `bistrolink-api` y `bistrolink-auth` de Railway a las bases nuevas, desplegar y validar como en 4.9 con las URLs de Railway.
5. Volver la URL de notificaciones de Mercado Pago a Railway.
6. Los datos que quedaron en las bases originales de Railway entre el último respaldo y la caída se revisan a mano y se recuperan solo si hace falta.
7. Cerrar la contingencia como en 5.1 y registrar el incidente en su ticket de Linear.

## 6. Simulacro

**Objetivo:** medir el RTO y el RPO reales de la activación, con Railway funcionando.

- **Cuándo:** con la contingencia en reposo (3.7), sin cambios pendientes en Render. Al menos una vez antes del 27/11/2026 y después de cada cambio de fondo (versión mayor de PostgreSQL o de Keycloak).
- **Caída simulada:** no se toca Railway. Se declara la caída a una hora (T0) y se ejecuta la sección 4 completa.
- **Roles:** quien ejecuta los pasos y quien registra y controla el tiempo. El registro lo da `tiempos.txt`.
- **RPO** = T0 − hora del respaldo usado (columna de `aws s3 ls`, en UTC: convertir a la hora de Uruguay, UTC−3).
- **RTO** = T1 − T0 (`tiempos.txt`).

**Registro** (ticket BL-217 y portafolio):

| Dato | Valor |
| ---- | ----- |
| Fecha y responsables | |
| Tag desplegado | |
| Origen del respaldo | S3 / R2 |
| Respaldo usado (fecha y hora) | |
| T0 / T1 | |
| **RPO** (objetivo ≤ 24 h) | |
| **RTO** (objetivo ≤ 4 h) | |
| Tiempo por paso (4.2 a 4.9) | De `tiempos.txt` |
| Incidencias y cómo se resolvieron | |
| Mejoras para la próxima vez | |

## 7. Con cada release

Para que la contingencia no levante una versión vieja:

1. **El PR lo abre el pipeline.** Al terminar el deploy de una versión final (`vX.Y.Z`; no los ensayos `-rc.N`), el job de producción abre un PR a `develop` que cambia en `render.yaml` el tag de las imágenes de API y Auth y `NEXT_PUBLIC_APP_VERSION` al tag nuevo. Lo abre una GitHub App del equipo para que corran los checks obligatorios; el *Summary* de la corrida del tag tiene el link.
2. **Revisar el PR** (`chore(BL-217): contingencia en render con las imagenes de vX.Y.Z`): el diff tiene que mostrar solo esas 3 líneas, con el tag anterior y el nuevo. Aprobar y mergear como cualquier PR.
3. Al mergearlo, Render sincroniza el Blueprint y actualiza los servicios, aunque estén suspendidos. Comprobar en *Settings → Image* de API y Auth que quedó el tag nuevo y, en la Web, *Environment* → `NEXT_PUBLIC_APP_VERSION`. **No** activar ni desplegar los servicios.
4. La Web no hace falta: se compila desde `main` al activar (4.8).

**Si el PR no aparece** (el *Summary* dice que no se pudo abrir, o hubo un rollback automático y después se corrigió a mano), abrirlo a mano: en `render.yaml`, reemplazar el tag anterior por el nuevo en las 3 líneas (`git diff` tiene que mostrar solo esas 3), commit con `npm run commit` (`chore`, `BL-217`) y PR a `develop`. Si el pipeline no lo abrió porque el archivo no tenía exactamente 3 apariciones del tag anterior, revisar qué cambió en `render.yaml` antes de editarlo.

## 8. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
| ------- | -------------- | --------- |
| `AccessDenied` en `s3:ListBucket` al bajar el respaldo | Se usaron credenciales que no pueden listar el bucket | Usar las de solo lectura de los respaldos (4.2) |
| `$env:RENDER_DB_URL -match '/bistrolink$'` da `False` | Render agregó un sufijo al nombre de la base | Crear la base `bistrolink` y reemplazar el nombre en la URL (4.3) |
| `ERROR: syntax error at end of input` con `psql -c` | PowerShell quitó las comillas internas del comando | Pasar el SQL por la entrada estándar: `"…" \| docker run --rm -i … sh -c 'psql $RENDER_DB_URL'` |
| `unrecognized configuration parameter "app.tenant_id"` al verificar | Una consulta sobre una tabla con RLS forzado, como dueño que no es superusuario | Es esperable: el RLS se aplica también al dueño. Usar `03-verificar-restauracion.sql`, que no lee las filas |
| Keycloak suspendido sin ningún deploy | Nunca se desplegó (el primer deploy del Blueprint falló o no corrió) | *Manual Deploy → Deploy latest reference* (4.6) |
| `Invoke-WebRequest` pregunta por *Script Execution Risk* | Windows PowerShell analiza el HTML de la respuesta | Responder `N` y agregar `-UseBasicParsing` |
| *Image Pull Failed* en API o Auth | Token de GHCR vencido o revocado, o el tag no existe | Renovar el token de GHCR (3.2) o corregir el tag (sección 7) |
| El Blueprint da error de `plan` | Render cambió los nombres de las instancias | Usar los nombres nuevos (por ejemplo `0.5c-512mb` por `starter` y `1c-2g` por `standard`) en un PR |
| `pg_restore` se corta con *must be owner of …* | Un objeto del respaldo que solo un superusuario puede crear o comentar | Borrar la base, crearla de nuevo (4.3) y restaurar sin `--exit-on-error`. Revisar que los únicos errores sean de dueño o de comentarios, y anotarlo en el registro |
| `04-verificar-rls.sql` da más de 0 pedidos | `bistrolink_app` tiene bypass de RLS, o se conectó con otro usuario | No seguir. Revisar `current_user` y `rolbypassrls`; si el rol está mal, borrar la base y empezar de nuevo |
| El *pre-deploy* de la API falla | `DATABASE_URL` mal cargada o una migración que no aplica | *Logs* del deploy. Corregir la variable; si es una migración, ver `migraciones-y-seed.md` |
| `/health/ready` da `postgres: unavailable` | `RUNTIME_DATABASE_URL` mal cargada, o base y API en regiones distintas | Revisar el host interno y la contraseña (4.5). Base y servicios en Ohio |
| `set-client-secret.sh` falla al iniciar sesión | La contraseña del administrador en la base restaurada no coincide con `KC_BOOTSTRAP_ADMIN_PASSWORD` de Infisical | Usar la credencial de administrador vigente de producción para cargarla en Render, y corregir Infisical si quedó desactualizado |
| Login: «Invalid redirect uri» | Falta la URL de Render en el cliente del frontend | Repetir el paso 4 de 4.6 |
| Login: «Invalid token issuer» en la API | `KEYCLOAK_URL` de la API distinta de `KC_HOSTNAME` | Las dos tienen que ser la URL pública de Keycloak en Render |
| Error de CORS en el navegador | `FRONTEND_URL` de la API distinta de la URL de la Web | Corregirla y redesplegar la API |
| La Web llama a la API de Railway | Se compiló con otras URLs | Revisar las `NEXT_PUBLIC_*` y volver a desplegar (4.8) |
| El KDS no se conecta | `NEXT_PUBLIC_WS_URL` mal cargada | Tiene que ser `wss://` + el dominio de la API de Render |

## 9. Seguridad

- **Sin secretos en el repositorio:** `render.yaml` y los scripts SQL no tienen credenciales. Las credenciales llegan desde Infisical; las de la base se generan al activar y viven solo en Render mientras existe la base.
- **Base sin acceso público:** la IP de quien restaura (`/32`) se habilita solo durante la restauración y solo en las reglas de la base (4.3 y 4.4).
- **RLS igual que en producción:** la API se conecta como `bistrolink_app`, sin bypass, y se verifica antes de reanudar los servicios (`04-verificar-rls.sql`).
- **Respaldos en la PC:** se bajan a una carpeta fuera del repositorio y se borran al terminar (5.1). Tienen datos de producción en sandbox y los hashes de las contraseñas de Keycloak.
- **Simulacro sin efectos en producción:** los procesos en segundo plano quedan apagados y no se hacen pagos, para no tocar Mercado Pago, Surtec ni el bucket de CFE de producción.
- **Clave de la API de Render:** limitada al workspace y con permisos mínimos (3.4). Se guarda solo en la conexión de Infisical. Si se filtra, se revoca en *Account Settings → API Keys* y se crea otra.
- **Usuario temporal de la validación:** existe solo en el Keycloak de Render y se borra con la base (4.9 y 5.1). Producción no se toca.
