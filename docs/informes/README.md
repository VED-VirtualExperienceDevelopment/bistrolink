# Informes de regresión por capa

> **Ticket:** BL-601 · **Documentación del proyecto:** Anexo 9 §3 (revisión por la dirección) y §10.2 (métricas del proceso); Anexo 11 (informe de resultados de pruebas); Línea de Base §3.4.4 (revisión de la efectividad del sistema de calidad en H5 y H8).

## Control de versiones

| Versión | Fecha      | Cambio |
| ------- | ---------- | ------ |
| 1.0     | 22/11/2026 | Primera versión: procedimiento y plantilla del informe por capa (H8 y cierre). |

## Para qué sirve

Al cerrar una capa (H5, H8) y en el cierre del proyecto se hace una regresión completa en staging y se revisa la efectividad del sistema de calidad. Este informe deja una **foto de los números a esa fecha** (los dashboards cambian todos los días) y la **parte de análisis** que no se automatiza. Es la entrada de la revisión por la dirección.

Un archivo por hito: `regresion-H8.md`, `regresion-cierre.md`, copiados de [`regresion-HX.md`](regresion-HX.md).

## Cómo se arma

1. **Regresión en staging:** correr el CI completo sobre `develop` (*Actions → CI/CD BistroLink → Run workflow*, con el reporte a Kiwi activado) y las pruebas manuales del plan de la capa en Kiwi TCMS.
2. **Marcar la evidencia en Kiwi:** en cada Test Run de esa regresión (unitarios no, porque no van a Kiwi), editar el resumen (*Summary*) y agregar al principio la marca **`[REGRESION-H8]`** (o **`[CIERRE]`**). La limpieza de `cleanup-test-runs.yml` nunca borra los runs marcados.
3. **Publicar los dashboards:** *Actions → Publicar dashboards → Run workflow*, para que la foto sea del día.
4. **Copiar la plantilla** a `regresion-H8.md` (o `regresion-cierre.md`) y completar:
   - los **números** de la sección 2, copiados del dashboard [Calidad del proceso](https://ved-virtualexperiencedevelopment.github.io/bistrolink/calidad-proceso.html) y del de [Bugs](https://ved-virtualexperiencedevelopment.github.io/bistrolink/bugs.html);
   - el **análisis** de las secciones 3 a 6.
5. **PR** con el informe, revisado por otro integrante. El Product Owner lo aprueba en la tabla de control de versiones del informe.

## Qué no va en el informe

Como el repositorio es público: ningún mensaje de error completo, token, contraseña, dato de prueba ni captura con datos de usuarios. Los fallos se nombran por el título del caso (`[TC-E-NNN] …`) y se enlazan al Test Run de Kiwi o al issue.
