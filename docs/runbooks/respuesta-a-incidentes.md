# Runbook: respuesta a incidentes (primeros 30 minutos)

> **Ticket:** BL-261 · **Relacionado:** BL-214 (alertas), BL-217 (contingencia Railway → Render), BL-227 (gestión de secretos) · **Documentación del proyecto:** Anexo 12; Línea de Base, Tabla 10 (riesgos R-03, R-10, R-14 y R-15).

## Control de versiones

| Versión | Fecha      | Cambio |
| ------- | ---------- | ------ |
| 1.0     | 08/11/2026 | Primera versión: roles, severidad, bitácora, procedimiento de 30 minutos, tres incidentes tipo y revocación de credenciales. |

## 1. Para qué sirve

Este runbook dice **quién hace qué y en qué orden** en los primeros 30 minutos de un incidente en staging o en producción.

En esos 30 minutos el objetivo es **contener, no arreglar**: cortar el daño, conservar la evidencia y avisar. La corrección de fondo viene después, con PR, revisión y el pipeline de siempre.

Es un incidente cualquier evento que:

- expone o puede exponer datos de un establecimiento a otro, o datos personales a terceros;
- deja la plataforma, el pago o la emisión de comprobantes sin funcionar;
- compromete una credencial (de un usuario, de un servicio o de la infraestructura);
- deja sin respaldo utilizable a una base de datos.

## 2. Cómo se detecta

| Fuente | Qué avisa | Dónde se ve |
| ------ | --------- | ----------- |
| Grafana Synthetic Monitoring | API, Web o Keycloak no responden | Correo de alerta · panel *Estado del servicio* |
| Alerta **API: errores 5xx** | 3 o más respuestas 5xx en 5 minutos, por entorno | Correo · Grafana → Alerting |
| Alerta **Pagos: webhook rechazado** | Mercado Pago no puede confirmar pagos (firma o secreto) | Correo · Grafana → Alerting |
| Alertas de Frontend Observability | Error nuevo de JavaScript, o aumento de un error conocido | Correo · Grafana → Frontend → *bistrolink-web* → Errors |
| Control de respaldos | Respaldo atrasado, demasiado chico o que no se puede restaurar | Correo de GitHub Actions |
| Pipeline (CI/CD) | Gitleaks, Trivy o CodeQL encuentran un problema; un smoke test falla después de un deploy | Pestaña Actions del repositorio |
| Personas | Reclamo de un establecimiento o de un comensal; algo visto en la consola de un proveedor | Cualquier canal del equipo |

Las alertas llegan por correo a todo el equipo. Que llegue una alerta no es todavía un incidente: quien la ve decide si lo es (sección 4, paso 1).

## 3. Roles y severidad

### 3.1 Roles

| Rol | Quién | Qué hace |
| --- | ----- | -------- |
| **Quien detecta** | Cualquier integrante | Declara el incidente y abre la bitácora. |
| **Coordinación** | El rol de Security Engineer del sprint. Si no está disponible, el responsable de infraestructura. | Decide, reparte tareas, comunica y lleva la bitácora al día. |
| **Ejecución** | Otro integrante, distinto de quien coordina | Hace los cambios: revocar, desactivar, rollback, restaurar. |

Con un equipo de tres personas, **coordinar y ejecutar no recaen en la misma persona**. Si quien detecta es también quien coordina, el primer paso es llamar a otra integrante para ejecutar.

### 3.2 Severidad

| Severidad | Criterio | Ejemplos |
| --------- | -------- | -------- |
| **Crítica** | Expone datos entre establecimientos o datos personales, o bloquea pagos o comprobantes en producción. | Un administrador ve pedidos de otro local; una credencial de la base filtrada; el webhook de pagos rechaza todo en producción. |
| **Alta** | Producción no funciona o funciona mal para todos, sin exposición de datos. | La API responde 5xx; Keycloak caído; un deploy dejó la web rota. |
| **Media** | Afecta a staging, o a producción de forma parcial y con alternativa. | Staging caído; un error de JavaScript en una pantalla con otra forma de hacer lo mismo. |
| **Baja** | No afecta el servicio, pero hay que revisarlo. | Un respaldo atrasado que se completa al reintentar. |

La severidad usa el mismo criterio que la clasificación de defectos del Plan de Pruebas (Anexo 11). Se puede subir o bajar durante el incidente; cada cambio queda en la bitácora.

## 4. Procedimiento de los primeros 30 minutos

### Minutos 0 a 5: declarar

1. Abrir un issue en GitHub con la plantilla **Incidente** (etiqueta `incidente`). Ese issue es la **bitácora**: todo lo que se hace se anota ahí, con la hora y quién lo hizo.
2. Completar: hora de detección, quién lo detectó, síntoma, entorno y severidad inicial.
3. Avisar al resto del equipo por el canal habitual, con el link al issue.
4. Asignar coordinación y ejecución (sección 3.1).

> La bitácora no lleva valores de secretos, tokens, contraseñas ni datos personales. Si hace falta referirse a uno, se lo nombra (por ejemplo, «la access key de la API»), nunca se pega el valor. El repositorio es público.

### Minutos 5 a 15: contener

Cortar la causa **sin borrar evidencia**. Según el caso (sección 5):

- revocar la credencial o cerrar las sesiones involucradas;
- desactivar el usuario o el establecimiento afectado;
- volver a la versión anterior con el job de rollback (`docs/RELEASE.md`, sección 3);
- frenar los deploys: no mergear a `develop` ni crear tags hasta cerrar el incidente.

No reiniciar ni borrar servicios, volúmenes o logs para «limpiar»: se pierde la evidencia.

### Minutos 15 a 25: conservar evidencia y medir el alcance

1. Exportar los logs del período desde Grafana (Explore → `grafanacloud-bistrolink-logs`, filtrando por `env` y por la ventana de tiempo).
2. Si interviene Keycloak: eventos de usuario y de administración del realm `bistrolink`.
3. Si interviene la infraestructura: actividad del proyecto en Railway y eventos de AWS CloudTrail.
4. Guardar capturas de la configuración relevante, sin valores de secretos.
5. Responder en la bitácora tres preguntas: **qué establecimientos** se afectaron, **qué datos** y **desde cuándo**.

### Minutos 25 a 30: comunicar y decidir

1. Informar a los establecimientos afectados y al tutor del proyecto: qué pasó, qué se hizo y qué sigue.
2. Decidir si hace falta restaurar desde un respaldo (`docs/runbooks/respaldo-y-restauracion.md`, sección 6).
3. Si hubo acceso a datos personales, evaluar el aviso a la URCDP (`docs/runbooks/privacidad-y-datos-personales.md`).
4. Programar la corrección de fondo y el análisis de causa raíz para la retrospectiva.

## 5. Tres incidentes tipo

| | Fuga de datos entre establecimientos (R-14) | Credencial filtrada (R-10) | Caída después de un deploy (R-03) |
| --- | --- | --- | --- |
| **Severidad** | Crítica | Crítica si es de la base o de la infraestructura; alta si es de un usuario | Alta en producción, media en staging |
| **Cómo se detecta** | Test de aislamiento en rojo, reclamo de un establecimiento, accesos con un `tenant_id` ajeno en los logs | Gitleaks en un PR, aviso de *secret scanning* de GitHub, actividad anómala en Railway, AWS o Keycloak | Smoke test del pipeline en rojo, alerta de Synthetic Monitoring o de 5xx, reportes de usuarios |
| **Contención (min 5–15)** | Desactivar la funcionalidad o el endpoint afectado (rollback si vino con un deploy), cerrar las sesiones involucradas, frenar los deploys | Revocar la credencial (sección 6) y redesplegar los servicios que la usan | Rollback a la versión anterior con el job del pipeline (no toca la base) |
| **Evidencia** | Logs de la API filtrados por el endpoint y el período; qué datos y de qué establecimientos se devolvieron | Desde cuándo estuvo expuesta; actividad con esa credencial desde ese momento | Logs del deploy en Railway y de la API; versión anterior y nueva |
| **Recuperación** | Corregir la política RLS o el endpoint con revisión de otra integrante, sumar un caso de regresión en Kiwi TCMS, redesplegar | Si hubo acceso a datos, seguir como fuga de datos | Si se dañó la base: restaurar desde el último respaldo verificado. Si cayó todo el proveedor: contingencia en Render (BL-217) |

## 6. Revocar una credencial comprometida

| Qué se comprometió | Cómo se revoca | Efecto |
| ------------------ | -------------- | ------ |
| Cuenta de un usuario de un establecimiento | Desactivarla desde *Admin → Usuarios* | Se cierran todas sus sesiones en Keycloak y se rechaza el próximo login. El access token ya emitido vence en 15 minutos como máximo. |
| Cuenta de plataforma (rol `PLATAFORMA`) | Desactivarla en la consola de Keycloak y quitarle el OTP | Igual que la anterior. |
| Secreto del cliente del backend en Keycloak | Regenerarlo en Keycloak y redesplegar la API | La API toma el secreto nuevo por referencia. |
| Credencial de administración de Keycloak | Cambiarla en la consola y en el gestor de secretos, y redesplegar | El arranque del contenedor usa la credencial nueva. |
| Access key de AWS | Desactivarla en IAM, crear una nueva, cargarla en el gestor de secretos y redesplegar | La key vieja deja de funcionar al desactivarla. |
| Token de Railway, de GitHub o de Grafana | Revocarlo en la plataforma, generar uno nuevo y actualizar el secreto donde se usa | El pipeline o la integración deja de funcionar con el token viejo. |
| Contraseña de una base de datos | Cambiarla en Railway y redesplegar los servicios que la usan por referencia | Las conexiones viejas se cortan al redesplegar. |
| Secreto del webhook de Mercado Pago | Regenerarlo en Mercado Pago, cargarlo en el gestor de secretos y redesplegar la API | Mientras no coincidan, los webhooks se rechazan; la conciliación recupera los pagos después. |

Toda credencial nueva se carga en el **gestor de secretos** y desde ahí se sincroniza a Railway y a GitHub. No se escribe a mano en Railway, ni se comparte por chat, issues o capturas.

## 7. Cierre

Un incidente se cierra cuando:

- la causa está contenida y el servicio funciona normalmente;
- la corrección de fondo está en un PR o en el backlog, con su ticket;
- la bitácora tiene la línea de tiempo completa y la severidad final.

Después del cierre:

1. Análisis de causa raíz en la retrospectiva del sprint: qué pasó, por qué no se detectó antes y qué se cambia.
2. Si el incidente lo permitió por una falla de proceso, actualizar este runbook (con una fila nueva en el control de versiones).
3. Registrar el incidente y su resolución en el Anexo 12 (registro de verificaciones).

## 8. Ensayo

El procedimiento se ensaya como **ejercicio de mesa** junto con el simulacro de contingencia de BL-217: se elige un incidente tipo, se recorren los cuatro tramos con el reloj en marcha y se anota cuánto llevó cada uno. El resultado y los ajustes quedan en el Anexo 12.
