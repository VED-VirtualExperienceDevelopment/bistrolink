# Descripciones de los contratos PactJS (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                                     |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 27/10/2026 | TC-C-001 a 009: contratos de Mercado Pago (API Orders y notificación de webhook, BL-215), plan nuevo «Contract-PactJS».                                          |
| 1.1     | 31/10/2026 | TC-C-010 a 014: contratos de Surtec (autenticación y emisión de e-Ticket, BL-216).                                                                               |
| 1.2     | 02/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-C-015 y 016: emisión de e-Factura en Surtec (HU-009, BL-453).                                         |
| 1.3     | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-C-017 y 018: consulta del estado de los CFE ante la DGI en Surtec (HU-009, BL-455).                   |
| 1.4     | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-C-019: emisión con Surtec no disponible (HU-023, BL-96).                                              |
| 1.5     | 07/11/2026 | Se borra el bloque de TC-C-019, ya cargado en Kiwi. TC-C-021 y 022: nota de crédito en Surtec y reembolso en Mercado Pago (HU-024, BL-104).                      |
| 1.6     | 07/11/2026 | Se borran los bloques de TC-C-021 y 022, ya cargados en Kiwi. TC-C-020: PDF de un CFE emitido en Surtec (HU-009, BL-454).                                        |
| 1.7     | 08/11/2026 | TC-C-017 y 018: la consulta del estado ante la DGI pasa a la API v2 de Surtec, por id y por id_externo (HU-009, BL-471); cambian el título y la descripción.     |
| 1.8     | 08/11/2026 | Se borran los bloques de TC-C-017, 018 y 020, ya cargados en Kiwi. TC-C-023 a 026: API de POS que define BistroLink (HU-011, BL-488), proveedor nuevo `pos-api`. |
| 1.9     | 09/11/2026 | Se borran los bloques de TC-C-023 a 026, ya cargados en Kiwi. TC-C-027: listado de las ventas hechas en el POS (HU-011, BL-489).                                 |

Texto del campo de descripción de cada caso TC-C en Kiwi. Lo carga
`cargar-casos-integracion.mjs --contrato --descripciones`: cada bloque
`## TC-C-NNN` reemplaza la descripción de ese caso, y solo si cambió. Los
casos que no están en este archivo no se tocan. Convenciones en
`apps/backend/test/contract/README.md`.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`. Sin credenciales, tokens reales ni URLs de entornos: el
repositorio es público.

## Ejemplo

    ## TC-C-010

    ### Precondición
    Estado del proveedor que fija el contrato («given»).

    ### Pasos
    1. Lo que hace BistroLink contra el mock del proveedor.

    ### Resultado esperado
    Lo que tiene que responder el proveedor y lo que hace nuestro código.

## Casos para cargar

## TC-C-027

### Precondición

El POS tiene una venta de mostrador del establecimiento.

### Pasos

1. BistroLink manda GET /ventas con Bearer token y los parámetros `establecimiento` (id del tenant, UUID), `desde` (ISO 8601) y `limite`.

### Resultado esperado

El POS responde 200 con `ventas`: cada una con `id`, `referencia` (null si se hizo en el POS; el id del pedido si la mandó BistroLink), `fecha`, `total`, `medioPago`, `anulada` y `actualizadaEn`. BistroLink la convierte en una venta del POS para importar.
