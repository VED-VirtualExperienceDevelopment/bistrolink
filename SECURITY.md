# Política de seguridad

## Cómo reportar una vulnerabilidad

Si encontrás una vulnerabilidad en BistroLink:

- **No abras un issue público** en GitHub ni la menciones en un PR o un comentario.
- Mandá los detalles al equipo por correo: **bistrolink.equipoved@gmail.com**.
- Incluí qué componente afecta (API, Web, Auth o infraestructura), los pasos para reproducirla y el impacto que estimás.
- Respondemos en un plazo de **48 horas hábiles**.

## Versiones con soporte

| Versión                                           | Soporte |
| ------------------------------------------------- | ------- |
| Último release publicado en `main` (tag `vX.Y.Z`) | Sí      |
| `develop` (staging)                               | Sí      |
| Releases anteriores                               | No      |

## Alcance

BistroLink es un proyecto académico. El entorno `production` funciona con las integraciones de pago y facturación en modo sandbox y sin datos personales reales.

Al investigar un posible problema:

- No accedas a datos de otros usuarios ni los modifiques, y no afectes la disponibilidad de los entornos.
- No hagas pruebas automatizadas de carga ni de fuerza bruta contra staging o production.

Reportar una vulnerabilidad no otorga ninguna licencia ni derecho sobre el código: todos los derechos están reservados (ver [COPYRIGHT.md](COPYRIGHT.md)).

## Controles del repositorio

- El repositorio y la organización son **públicos**: todo el código, los commits y los comentarios son visibles.
- Ninguna credencial se guarda en el repositorio. Los secretos de la aplicación se gestionan en el gestor de secretos del equipo, y los del pipeline en los secretos de GitHub Actions.
- Cada PR pasa por detección de secretos (Gitleaks), análisis estático (CodeQL y SonarCloud) y análisis de dependencias e imágenes (Trivy y `dependency-review`).

## Organización

El repositorio es parte de la organización de GitHub [VED-VirtualExperienceDevelopment](https://github.com/VED-VirtualExperienceDevelopment).
