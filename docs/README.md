<p align="center">
  <img src="assets/banner-docs.svg" alt="BistroLink · Documentación" width="100%">
</p>

<p align="center">
  <a href="../README.md">← BistroLink</a> ·
  <a href="https://ved-virtualexperiencedevelopment.github.io/bistrolink/"><img src="https://img.shields.io/badge/dashboards-GitHub%20Pages-c9a74d" alt="Dashboards en GitHub Pages"></a>
</p>

## Índice de la documentación del repositorio

### Decisiones de arquitectura (ADR)

Cada ADR registra una decisión técnica: el contexto, la decisión, las alternativas descartadas y sus consecuencias. Todas están aceptadas por el equipo.

| ADR | Decisión | Fecha |
|---|---|---|
| [0001](adr/0001-monolito-modular-en-nestjs.md) | Monolito modular en NestJS | 28/09/2026 |
| [0002](adr/0002-multi-tenancy-realm-compartido-y-rls.md) | Multi-tenancy con un realm compartido de Keycloak y Row Level Security | 02/08/2026 |
| [0003](adr/0003-gestion-de-secretos-con-infisical.md) | Gestión de secretos con Infisical como fuente única | 30/09/2026 |
| [0004](adr/0004-produccion-con-integraciones-en-sandbox.md) | Producción como entorno productivo con integraciones en sandbox | 30/09/2026 |
| [0005](adr/0005-auditoria-de-dependencias-con-trivy.md) | Auditoría de dependencias con Trivy y dependency-review en lugar de Snyk | 10/10/2026 |
| [0006](adr/0006-prepago-con-estado-pendiente-pago.md) | Prepago con el estado PENDIENTE_PAGO | 18/10/2026 |
| [0007](adr/0007-carga-segura-de-imagenes-de-la-carta.md) | Carga segura de imágenes de la carta | 21/10/2026 |
| [0008](adr/0008-imagenes-de-la-carta-por-cdn.md) | Imágenes de la carta del comensal por CDN con URL estable | 31/10/2026 |
| [0009](adr/0009-stock-descuento-al-confirmar-el-pago-y-sobreventa-avisada.md) | Stock: descuento al confirmar el pago y sobreventa avisada | 03/11/2026 |
| [0010](adr/0010-cola-del-kds-y-limite-de-preparacion.md) | Cola del KDS y límite de pedidos en preparación | 05/11/2026 |
| [0011](adr/0011-limpieza-de-datos-de-prueba.md) | Limpieza de los datos de prueba (staging y local) | 06/11/2026 |
| [0012](adr/0012-integracion-de-pagos.md) | Integración de pagos | 08/11/2026 |
| [0013](adr/0013-estado-de-la-mesa-con-varios-cobros.md) | Estado de la mesa con varios cobros | 10/11/2026 |
| [0014](adr/0014-token-de-invitado-del-comensal-emitido-por-la-api.md) | Token de invitado del comensal emitido por la API | 18/11/2026 |
| [0015](adr/0015-bot-de-whatsapp-con-evolution-api.md) | Bot de pedidos por WhatsApp con Evolution API | 21/11/2026 |

### Runbooks

| Documento | Para qué |
|---|---|
| [Migraciones y seed](runbooks/migraciones-y-seed.md) | Cómo llegan las migraciones a cada entorno, cómo correr el seed y qué hacer si falla el *pre-deploy* |
| [Respaldo y restauración](runbooks/respaldo-y-restauracion.md) | Configuración, operación y restauración de los respaldos de las bases |
| [Contingencia en Render](runbooks/contingencia-render.md) | Cómo se levanta producción en Render si Railway no está disponible: preparación, restauración desde S3 o R2, validación, vuelta a Railway y simulacro con RTO y RPO (BL-217) |
| [Respuesta a incidentes](runbooks/respuesta-a-incidentes.md) | Quién hace qué en los primeros 30 minutos de un incidente: severidad, bitácora, contención y revocación de credenciales |
| [Privacidad y datos personales](runbooks/privacidad-y-datos-personales.md) | Obligaciones del establecimiento y procedimientos con los datos personales que trata el sistema (Ley 18.331, HU-036) |
| [Bot de WhatsApp con Evolution API](runbooks/whatsapp-evolution.md) | Variables, Evolution en Railway, webhook de la instancia, prueba local y datos personales del bot de pedidos (HU-010) |

### Seguridad

| Documento | Para qué |
|---|---|
| [Endpoints públicos](security/public-endpoints.md) | Modelo de amenazas y capas de defensa de los endpoints sin autenticación (menú del comensal) |
| [Análisis dinámico (DAST)](security/dast.md) | Escaneo de staging con OWASP ZAP: alcance, cómo correrlo, criterio de salida y cómo registrar los hallazgos |
| [Informe del DAST](security/dast-informe.md) | Resultados de las corridas, decisión sobre cada hallazgo y riesgos aceptados |
| [Checklist OWASP ASVS nivel 1](security/asvs-nivel-1.md) | Revisión de los requisitos de nivel 1 contra el código, con la evidencia de cada uno |
| [Política de seguridad](../SECURITY.md) | Cómo reportar una vulnerabilidad |

### Proceso

| Documento | Para qué |
|---|---|
| [Guía de commits](COMMITS.md) | Formato de los commits y uso de `npm run commit` |
| [Release, hotfix y rollback](RELEASE.md) | Cómo se pasa una versión a producción con un tag, cómo se corrige un error urgente y cómo se vuelve a una versión anterior (automático si falla el deploy, o manual), con el aviso de incidente |
| [Informes de regresión por capa](informes/README.md) | Cómo se arma el informe de H8 y del cierre: regresión en staging, evidencia marcada en Kiwi y la [plantilla](informes/regresion-HX.md) (BL-601) |

### Dashboards

| Documento | Para qué |
|---|---|
| [Avance de la EDT](dashboard-avance-edt.md) · [sitio](https://ved-virtualexperiencedevelopment.github.io/bistrolink/avance-edt.html) | Avance por capa y sprint, generado desde Linear |
| [Bugs](dashboard-bugs-github.md) · [sitio](https://ved-virtualexperiencedevelopment.github.io/bistrolink/bugs.html) | Bugs abiertos y resueltos, generado desde GitHub Issues |
| [Calidad del proceso](dashboard-calidad-proceso.md) · [sitio](https://ved-virtualexperiencedevelopment.github.io/bistrolink/calidad-proceso.html) | Métricas DORA de producción y de staging, plan de pruebas en Kiwi TCMS y cobertura de código, generado desde GitHub, Kiwi y Codecov (BL-221, BL-601) |
| Estado del servicio · desde el [sitio](https://ved-virtualexperiencedevelopment.github.io/bistrolink/) | Disponibilidad y tiempo de respuesta de la API y Keycloak (Grafana Synthetic Monitoring, BL-243). El link al dashboard público de Grafana está en la variable de Actions `GRAFANA_ESTADO_URL` |

Los `.md` de los dashboards los regenera el workflow `publicar-dashboards.yml`. La versión actualizada está siempre en el sitio.

### README de cada componente

[API](../apps/backend/README.md) · [Tests de contrato](../apps/backend/test/contract/README.md) · [Frontend](../apps/frontend/README.md) · [Keycloak](../keycloak/README.md) · [Tests E2E](../e2e/README.md) · [Kiwi TCMS](../testmgmt/README.md) · [Respaldos](../infra/backup/README.md) · [Réplica en R2](../infra/replica-r2/README.md) · [Dashboards](../scripts/dashboards/README.md) · [Limpieza de datos de prueba](../scripts/limpieza/README.md)

### Recursos gráficos

`assets/` tiene los banners de los README, con los colores y la tipografía de BistroLink (Plus Jakarta Sans, licencia OFL), con el texto convertido a trazos.
