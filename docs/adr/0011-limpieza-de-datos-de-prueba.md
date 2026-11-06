# ADR 0011 — Limpieza de los datos de prueba (staging y local)

| Campo | Valor |
| --- | --- |
| Estado | Propuesta |
| Fecha | 06/11/2026 |
| 1.1 | 06/11/2026 | Aceptada por el equipo. |
| Referencias | BL-285 (BL-475 a BL-482); BL-197; BL-232; BL-253; BL-275; BL-418; BL-441; ADR 0002; ADR 0006; hallazgos D2 y D8 |
| Autores | E. Arenas, V. Couto, D. Silvera |

## Contexto

Los E2E corren contra staging en CI y contra la base local en la PC de cada integrante. Crean pedidos, mesas, ítems de la carta, usuarios y establecimientos, y no siempre los dejan como estaban: un test que falla a mitad de camino no llega a su limpieza, y algunas limpiezas tenían errores (TC-E-063 dejaba tres pedidos con aviso de efectivo sin cobrar por corrida). El resultado es un KDS, «Cobros pendientes» y «Alertas» llenos de datos de prueba: staging no sirve para una demo sin limpiarlo a mano, y algunos tests se vuelven inestables.

Restricciones:

- Con prepago (ADR 0006), casi todos los pedidos de prueba quedan **pagados y con CFE**: son registros fiscales.
- La base de staging no tiene acceso público (hallazgos D2 y D8): solo se entra con el túnel de la CLI de Railway.
- Los datos están aislados por tenant con RLS (ADR 0002, BL-275).
- Los tenants de testing A y B los carga el seed (BL-197), que es idempotente.

## Decisión

- **Limpieza por la API, no por la base.** Un módulo `testing` en el backend expone `POST /testing/limpieza` (rol ADMIN, en el tenant del token) y `POST /testing/limpieza/establecimientos` (rol PLATAFORMA). Reusa los servicios, el RLS, la auditoría y los eventos del KDS que ya existen.
- **Solo existe donde se habilita.** El módulo se registra únicamente con `E2E_CLEANUP_ENABLED=true` (staging y local). En producción la variable no se define, el módulo no se carga y las rutas responden 404. Queda en el checklist de producción (BL-232).
- **Cerrar, no borrar.** Ninguna limpieza borra pedidos:

  | Pedido de prueba abierto | Pasa a |
  | --- | --- |
  | `PENDIENTE_PAGO` (incluye el aviso de efectivo) | `CANCELADO` |
  | `RECIBIDO`, `EN_PREPARACION`, `LISTO_PARA_ENTREGAR` | `ENTREGADO` |

  Cada cambio queda en el historial de estados y en la auditoría (`PEDIDO_LIMPIEZA_PRUEBAS`). Las alertas del mozo, que viven en memoria (BL-441), se sacan con el gateway.
- **Qué es un dato de prueba.** Solo se toca:
  - lo que tiene la marca de los E2E: nombres «E2E …» (categorías, ítems, zonas, establecimientos) y usuarios `e2e-…`;
  - lo que define el seed, que vuelve a su valor: mesas, ítems y configuración de los tenants de testing A y B.

  Las mesas 1 y 2 del seed quedan **abiertas** (con sesión), como las deja el seed, porque los QR de los E2E las usan para pedir. Lo demás que no tenga la marca no se toca.
- **Áreas.** El endpoint limpia por áreas (`pedidos`, `mesas`, `carta`, `configuracion`, `usuarios`), por defecto todas. Con `pedidoIds` cierra solo esos (fixture de cada E2E); con `antiguedadHoras` (por defecto 24; 0 = todo) limita por fecha. `dryRun` responde lo que haría sin cambiar nada.
- **Tres formas de usarla, con el mismo endpoint:**
  1. **Cada E2E**, en el teardown de un fixture: se ejecuta aunque el test falle.
  2. **Script `scripts/limpieza/limpiar-entorno.mjs`**, con `--entorno local|staging` (por defecto `local`) y *dry-run* salvo `--aplicar`. Pide un token por tenant de testing y uno de plataforma, y llama a los dos endpoints. En local: `npm run limpiar:local`.
  3. **Workflow `limpieza-staging.yml`**: todas las noches y a mano desde Actions (por ejemplo, antes de una demo), con *dry-run* por defecto.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Borrar los pedidos de prueba (versión inicial de BL-285) | Los pagados tienen CFE y no se borran. Si solo se borraran los no pagados, los pagados abiertos seguirían en el KDS y staging no quedaría limpio. |
| Conexión directa a la base desde el runner o la PC (SQL) | Exige exponer la base de staging a internet (D2, D8), se saltea el RLS y la auditoría, y no limpia lo que no está en la base (alertas en memoria, usuarios de Keycloak). |
| Volver a correr el seed | Es idempotente, pero solo actualiza sus propias filas: no cierra pedidos, ni borra los datos «E2E», ni saca alertas. Además en staging necesita el túnel. |
| `prisma migrate reset` | Borra toda la base. Nunca en staging (runbook de migraciones); en local pierde los datos cargados a mano y no limpia Keycloak. |
| Un «test de limpieza» al final de la suite | Playwright no garantiza el orden entre archivos y corre en paralelo; si la corrida se corta, no se ejecuta; y aparece como caso en Kiwi sin verificar nada. |
| Un endpoint por tipo de dato sin módulo propio | Mezcla código de testing en los módulos de negocio y obliga a proteger cada ruta por separado. |

## Consecuencias

- Hay código solo para testing dentro de la API. El riesgo es que se habilite por error en producción: lo mitigan la variable fuera de producción (BL-232), los roles ADMIN y PLATAFORMA, el RLS y que solo toque datos con la marca de los E2E.
- Todo E2E nuevo que cree datos tiene que usar la marca («E2E …», `e2e-…`) o registrarlos en el fixture de limpieza. Si no, la limpieza no los ve.
- Cuando cambia el seed, la limpieza tiene que reflejar los mismos valores (mesas, ítems, configuración). Si no, «como el seed» deja de ser cierto.
- Las ventas de los pedidos de prueba siguen en los reportes de staging, como hasta ahora.
- La corrida nocturna funciona como alarma: si casi todas las noches encuentra datos, algún test no limpia lo suyo.

## Control de versiones

| Versión | Fecha | Modificación |
| --- | --- | --- |
| 1.0 | 06/11/2026 | Versión inicial. |
