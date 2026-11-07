# Descripciones de los contratos PactJS (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                   |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 27/10/2026 | TC-C-001 a 009: contratos de Mercado Pago (API Orders y notificación de webhook, BL-215), plan nuevo «Contract-PactJS».                        |
| 1.1     | 31/10/2026 | TC-C-010 a 014: contratos de Surtec (autenticación y emisión de e-Ticket, BL-216).                                                             |
| 1.2     | 02/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-C-015 y 016: emisión de e-Factura en Surtec (HU-009, BL-453).                       |
| 1.3     | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-C-017 y 018: consulta del estado de los CFE ante la DGI en Surtec (HU-009, BL-455). |
| 1.4     | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-C-019: emisión con Surtec no disponible (HU-023, BL-96).                            |
| 1.5     | 07/11/2026 | Se borra el bloque de TC-C-019, ya cargado en Kiwi. TC-C-021 y 022: nota de crédito en Surtec y reembolso en Mercado Pago (HU-024, BL-104).    |

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

## TC-C-021

### Precondición

El emisor tiene emitido el e-Ticket A-49 en Surtec.

### Pasos

1. BistroLink pide POST /comprobantes/crear con tipo 102, el `id_externo` de la nota de crédito («bl-<pago>-nc») y `referencias` con el tipo (101), la serie, el número, la fecha y la razón del e-Ticket original.

### Resultado esperado

Surtec responde 200 con la serie y el número de la nota de crédito.

## TC-C-022

### Precondición

Existe una order de Mercado Pago procesada y acreditada.

### Pasos

1. BistroLink pide POST /v1/orders/{id}/refund con el body vacío (reembolso total) y la clave de idempotencia del pago.

### Resultado esperado

Mercado Pago responde 201 con la order en `status_detail` refunded, y BistroLink lo toma como reembolsado.
