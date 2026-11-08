<p align="center">
  <img src="../docs/assets/banner-testmgmt.svg" alt="BistroLink · Gestión de pruebas" width="100%">
</p>

<p align="center">
  <a href="../README.md">← BistroLink</a> ·
  <img src="https://img.shields.io/badge/Kiwi%20TCMS-381e72" alt="Kiwi TCMS">
  <img src="https://img.shields.io/badge/Docker-381e72?logo=docker&logoColor=white" alt="Docker">
</p>

## Kiwi TCMS

Instancia de gestión de pruebas de BistroLink. Guarda los casos de prueba, los planes y los resultados que reporta el pipeline (Jest, Playwright, k6 y Lighthouse).

- **Instancia en uso:** staging en Railway (URL en el [README raíz](../README.md#ambientes)). Las credenciales están en el gestor de contraseñas del equipo, nunca en el repositorio.
- **Imagen:** [`docker/`](docker/), que se escanea con Trivy en el pipeline.
- **Instancia local:** dada de baja (solo sirvió para validar el setup).

## Setup desde cero (contra una instancia nueva y vacía)

Antes de correr los scripts, crear a mano en la UI de Kiwi:

1. El Product `BistroLink` (Admin → Products).
2. El Test Plan `TP-1: Integration tests`, tipo `Integration`, asociado al
   Product de arriba. Confirmar que quede con ID `1` (si no, ajustar
   `TEST_PLAN_ID` en `create_test_cases.py`).

Después, con `pip install tcms-api` y las env vars seteadas
(`TCMS_URL`, `TCMS_USERNAME`, `TCMS_PASSWORD` apuntando a
`https://<tu-instancia>/xml-rpc/`), correr en este orden:

```
python create_components.py    # crea api, web, keycloak, evolution-api, postgresql
python create_test_cases.py    # crea los 13 TC, los asocia al plan y les asigna component
```

Ambos scripts son idempotentes — se pueden re-correr sin duplicar nada.

`list_component_methods.py` es una herramienta de diagnóstico (lista los
métodos RPC reales que expone el servidor); no hace falta correrla salvo
que algo falle por un método inexistente.

## docker-compose.testmgmt.yml

Referencia de cómo se armó la instancia local que se usó para probar todo
esto antes de migrar a Railway (imagen `pub.kiwitcms.eu/kiwitcms/kiwi:latest`

- MariaDB). No se usa para levantar producción.
