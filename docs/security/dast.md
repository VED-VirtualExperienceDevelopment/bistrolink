# Seguridad: análisis dinámico (DAST) con OWASP ZAP

BL-218 · Línea de Base §3.4.4 · Anexo 4 §1.8.7 · Anexo 11 «Seguridad dinámica».

El análisis estático (CodeQL, SonarCloud, Gitleaks, Trivy) revisa el código y las dependencias. El DAST ataca la aplicación ya desplegada en staging, como lo haría alguien de afuera: mira los encabezados, las cookies y los mensajes de error, y en el modo completo prueba inyección, XSS y otros ataques sobre la API.

## Alcance

| Dentro                                                          | Fuera                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| Web, API y Keycloak de **staging**                              | Producción                                                     |
| Endpoints REST de la API (contrato OpenAPI en `/api/docs-json`) | Pasarelas de pago y proveedores de CFE (sandboxes de terceros) |
| Pantallas públicas de la web y login de Keycloak                | La plataforma Railway                                          |
| Tenant de testing B, con su Admin                               | Pruebas de carga o de denegación de servicio                   |

La revisión de autorización (IDOR, saltar el RLS, acceso entre tenants) no la cubre ZAP: va en la revisión guiada por OWASP ASVS nivel 1, junto con los tests de aislamiento entre tenants que ya corren en el pipeline.

## Cómo corre

El workflow es [`.github/workflows/dast.yml`](../../.github/workflows/dast.yml). No bloquea el deploy: corre aparte.

| Modo         | Cuándo                                                                                                            | Qué hace                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **baseline** | Todas las noches a las **02:23** de Uruguay (05:23 UTC), sobre lo que haya en staging a esa hora. También a mano. | Escaneo **pasivo** de la web (spider de 3 minutos), de la API (importa el contrato OpenAPI sin atacar) y de la pantalla de login de Keycloak. |
| **completo** | Solo a mano. Al menos una vez antes de H8 (20/11).                                                                | Escaneo **activo** de la API con su contrato OpenAPI, autenticado con el Admin del tenant de testing B.                                       |

**Por qué de noche y no después de cada deploy:** con varios merges por día, las corridas se pisaban y cada una despertaba staging. Una corrida nocturna escanea el estado acumulado del día. Para ver el efecto de un cambio puntual, se corre a mano.

**Servicios dormidos:** staging es serverless (Railway) y de madrugada está dormido. Antes de escanear, el workflow espera a que respondan Keycloak, la API (con su base) y la web, con la acción compartida `despertar-staging` (hasta ~5 minutos, la misma que usan los E2E y la limpieza).

**Horario respecto de otros workflows nocturnos:** el baseline (05:23 UTC) termina antes del respaldo de las bases (06:00 UTC) y de «Limpieza de staging» (06:13 UTC).

**Para correrlo a mano:** Actions → «DAST (OWASP ZAP)» → Run workflow → rama `develop` → elegir el modo.

**Antes y después del modo completo:**

- Tiene que existir el secret `DAST_INFORME_CLAVE` (ver [Clave del informe](#clave-del-informe)). Sin él, el job se corta antes de escanear.
- No correrlo mientras corren los E2E de staging.
- El escaneo activo manda datos de ataque a los endpoints y puede crear o cambiar registros del tenant B. Al terminar, correr «Limpieza de staging» con `dry_run` sin tildar y `antiguedad_horas` en 0.
- El token del Admin dura 15 minutos (configuración del realm), por eso el escaneo activo se corta a los 13.

La versión de ZAP está fija en el workflow (`ZAP_IMAGEN`). Una versión nueva puede traer reglas nuevas y cambiar el resultado sin que cambie el código: se actualiza a mano y se compara contra la corrida anterior.

## Criterio de salida

| Riesgo de ZAP      | Qué pasa                                                        | Qué hacer                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Alto**           | El job falla.                                                   | Corregir antes del cierre del Sprint 8. Bloquea el release (Anexo 11 §9.5). Se registra según [dónde se registra cada hallazgo](#dónde-se-registra-cada-hallazgo). |
| **Medio**          | El job pasa, pero la alerta aparece en el resumen con un aviso. | Registrar con la severidad y el plazo del Anexo 11 §9.5, según [dónde se registra cada hallazgo](#dónde-se-registra-cada-hallazgo).                                |
| Bajo e informativo | Solo en el informe.                                             | Revisar en el informe de la corrida; se registran si corresponde.                                                                                                  |

## Repositorio público: qué se publica

El repositorio es público: el resumen del job, el log y los artifacts los puede ver cualquiera (los artifacts, cualquier usuario con sesión en GitHub).

| Modo         | Resumen del job y log                                                                                                               | Artifact                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **baseline** | Tabla de alertas con su URL de ejemplo. Es un escaneo pasivo: muestra lo que cualquiera ve con un navegador (encabezados, cookies). | `dast-baseline-<objetivo>`: informes HTML, JSON y Markdown, 30 días.                                                                                            |
| **completo** | Solo las cantidades por riesgo y si pasó. Sin nombres de alertas, URLs ni motivos. La salida de ZAP no va al log.                   | `dast-completo-api`: un solo archivo, `dast-completo-api.tar.gz.gpg`, cifrado con AES-256. Adentro: informes HTML, JSON y Markdown y la salida de ZAP. 90 días. |

### Dónde se registra cada hallazgo

| Tipo de hallazgo                                                                                      | Dónde                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encabezados, CSP, cookies, versiones expuestas: lo que se ve desde afuera sin atacar                  | Issue en GitHub, con la etiqueta `bug`                                                                                                                                              |
| Vulnerabilidad explotable sin corregir: inyección, XSS, saltar la autenticación, acceso entre tenants | **Aviso de seguridad privado**: Security → Advisories → New draft security advisory. Los pasos para reproducirla van solo ahí. Se publica, si corresponde, después de la corrección |
| Riesgo aceptado                                                                                       | Informe de la corrida en `docs/security/`, en términos generales y con su mitigación                                                                                                |

### Clave del informe

`DAST_INFORME_CLAVE` cifra el informe del modo completo.

- **Fuente:** Infisical, sincronizado a los secrets del repositorio, igual que las demás credenciales del pipeline.
- **Copia para descifrar:** KeePass del equipo.
- **Si se rota:** los informes anteriores se siguen abriendo con la clave anterior. Conservarla en KeePass hasta que venzan (90 días).

### Leer el informe del modo completo

1. En la corrida: **Summary** → **Artifacts** → `dast-completo-api`. Se descarga un `.zip` con `dast-completo-api.tar.gz.gpg` adentro.
2. Descomprimir el `.zip` y, en Git Bash (trae `gpg`), desde esa carpeta:

   ```bash
   gpg --decrypt -o dast-completo-api.tar.gz dast-completo-api.tar.gz.gpg
   tar -xzf dast-completo-api.tar.gz
   ```

   `gpg` pide la clave (la de KeePass). Queda la carpeta `zap/` con `api-completo.html`, `api-completo.json`, `api-completo.md` y `zap-salida.log`.

3. Revisar el informe en la máquina propia, **sin subirlo** al repositorio, a un issue ni a un PR. Al terminar, borrar la carpeta y los archivos descargados.

## Falsos positivos y riesgos aceptados

Las alertas revisadas y descartadas van en [`scripts/dast/reglas-zap.tsv`](../../scripts/dast/reglas-zap.tsv):

```text
<id>	IGNORE	<motivo: qué se revisó y dónde quedó la evidencia>
```

- El separador es un **TAB**, no espacios.
- El motivo es obligatorio. Lo controla el test `npm run test:dast`.
- Ignorar una alerta de riesgo alto necesita la aprobación del Security Engineer y la evidencia en el issue.

## Archivos

| Archivo                             | Qué hace                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/dast.yml`        | Los dos modos del escaneo.                                                                                                                              |
| `scripts/dast/resumen-zap.mjs`      | Lee el informe JSON de ZAP, arma el resumen del job y decide si pasa (sin riesgo alto). Con `--detalle no` (modo completo) publica solo las cantidades. |
| `scripts/dast/resumen-zap.test.mjs` | Tests del resumen: `npm run test:dast`.                                                                                                                 |
| `scripts/dast/reglas-zap.tsv`       | Alertas revisadas e ignoradas, con su motivo.                                                                                                           |
