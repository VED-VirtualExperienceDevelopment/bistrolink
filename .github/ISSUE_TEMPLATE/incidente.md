---
name: Incidente
about: Bitácora de un incidente en staging o producción (runbook docs/runbooks/respuesta-a-incidentes.md)
title: "[Incidente] "
labels: incidente
assignees: ""
---

<!--
Este issue es la bitácora del incidente. Todo lo que se haga se anota en los
comentarios, con la hora y quién lo hizo.

NO pegar valores de secretos, tokens, contraseñas ni datos personales: el
repositorio es público. Nombrar la credencial ("la access key de la API"),
nunca el valor.
-->

## Declaración

| Campo | Valor |
| --- | --- |
| Hora de detección | <!-- dd/mm/aaaa hh:mm (hora de Uruguay) --> |
| Detectado por | |
| Cómo se detectó | <!-- alerta de Grafana, pipeline, reclamo, etc. --> |
| Entorno | <!-- staging / production --> |
| Severidad inicial | <!-- crítica / alta / media / baja (sección 3.2 del runbook) --> |
| Coordina | |
| Ejecuta | |

## Síntoma

<!-- Qué se ve, sin conclusiones todavía. -->

## Alcance

- **Establecimientos afectados:**
- **Datos afectados:**
- **Desde cuándo:**

## Contención

<!-- Qué se hizo para cortar el daño, con la hora. -->

## Evidencia conservada

<!-- Qué se exportó o capturó y dónde quedó (sin valores de secretos). -->

## Comunicación

<!-- A quién se avisó y cuándo: establecimientos, tutor, URCDP si corresponde. -->

## Cierre

- [ ] Causa contenida y servicio normal
- [ ] Corrección de fondo en un PR o ticket:
- [ ] Severidad final:
- [ ] Análisis de causa raíz agendado para la retrospectiva
- [ ] Registrado en el Anexo 12
