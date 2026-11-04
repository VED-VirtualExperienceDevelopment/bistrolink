# Descripciones de los contratos PactJS (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                   |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 27/10/2026 | TC-C-001 a 009: contratos de Mercado Pago (API Orders y notificación de webhook, BL-215), plan nuevo «Contract-PactJS».                        |
| 1.1     | 31/10/2026 | TC-C-010 a 014: contratos de Surtec (autenticación y emisión de e-Ticket, BL-216).                                                             |
| 1.2     | 02/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-C-015 y 016: emisión de e-Factura en Surtec (HU-009, BL-453).                       |
| 1.3     | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-C-017 y 018: consulta del estado de los CFE ante la DGI en Surtec (HU-009, BL-455). |
| 1.4     | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-C-019: emisión con Surtec no disponible (HU-023, BL-96).                            |

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

## TC-C-019

### Precondición

El servicio de emisión de Surtec no está disponible.

### Pasos

1. BistroLink pide POST /comprobantes/crear de un e-Ticket.

### Resultado esperado

Surtec responde 503. BistroLink lanza SurtecError con ese status y lo trata como transitorio: el pago queda APROBADO sin comprobante, se registra el intento fallido y la conciliación de CFE (HU-023) lo reintenta después.
