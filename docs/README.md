<p align="center">
  <img src="assets/banner-docs.svg" alt="BistroLink · Documentación" width="100%">
</p>

<p align="center">
  <a href="../README.md">← BistroLink</a> ·
  <a href="https://ved-virtualexperiencedevelopment.github.io/bistrolink/"><img src="https://img.shields.io/badge/dashboards-GitHub%20Pages-c9a74d" alt="Dashboards en GitHub Pages"></a>
</p>

## Índice de la documentación del repositorio

### Runbooks

| Documento | Para qué |
|---|---|
| [Migraciones y seed](runbooks/migraciones-y-seed.md) | Cómo llegan las migraciones a cada entorno, cómo correr el seed y qué hacer si falla el *pre-deploy* |
| [Respaldo y restauración](runbooks/respaldo-y-restauracion.md) | Configuración, operación y restauración de los respaldos de las bases |
| [Respuesta a incidentes](runbooks/respuesta-a-incidentes.md) | Quién hace qué en los primeros 30 minutos de un incidente: severidad, bitácora, contención y revocación de credenciales |

### Seguridad

| Documento | Para qué |
|---|---|
| [Endpoints públicos](security/public-endpoints.md) | Modelo de amenazas y capas de defensa de los endpoints sin autenticación (menú del comensal) |

### Proceso

| Documento | Para qué |
|---|---|
| [Guía de commits](COMMITS.md) | Formato de los commits y uso de `npm run commit` |
| [Release, hotfix y rollback](RELEASE.md) | Cómo se pasa una versión a producción con un tag, cómo se corrige un error urgente y cómo se vuelve a una versión anterior |

### Dashboards

| Documento | Para qué |
|---|---|
| [Avance de la EDT](dashboard-avance-edt.md) · [sitio](https://ved-virtualexperiencedevelopment.github.io/bistrolink/avance-edt.html) | Avance por capa y sprint, generado desde Linear |
| [Bugs](dashboard-bugs-github.md) · [sitio](https://ved-virtualexperiencedevelopment.github.io/bistrolink/bugs.html) | Bugs abiertos y resueltos, generado desde GitHub Issues |
| Estado del servicio · desde el [sitio](https://ved-virtualexperiencedevelopment.github.io/bistrolink/) | Disponibilidad y tiempo de respuesta de la API y Keycloak (Grafana Synthetic Monitoring, BL-243). El link al dashboard público de Grafana está en la variable de Actions `GRAFANA_ESTADO_URL` |

Los `.md` de los dashboards los regenera el workflow `publicar-dashboards.yml`. La versión actualizada está siempre en el sitio.

### README de cada componente

[API](../apps/backend/README.md) · [Frontend](../apps/frontend/README.md) · [Keycloak](../keycloak/README.md) · [Tests E2E](../e2e/README.md) · [Kiwi TCMS](../testmgmt/README.md) · [Respaldos](../infra/backup/README.md)

### Recursos gráficos

`assets/` tiene los banners de los README, con los colores y la tipografía de BistroLink (Plus Jakarta Sans, licencia OFL), con el texto convertido a trazos.
