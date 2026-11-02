# Descripciones de los contratos PactJS (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                             |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1.0     | 27/10/2026 | TC-C-001 a 009: contratos de Mercado Pago (API Orders y notificación de webhook, BL-215), plan nuevo «Contract-PactJS».  |
| 1.1     | 31/10/2026 | TC-C-010 a 014: contratos de Surtec (autenticación y emisión de e-Ticket, BL-216).                                       |
| 1.2     | 02/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-C-015 y 016: emisión de e-Factura en Surtec (HU-009, BL-453). |

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

## TC-C-015

### Precondición

El emisor está habilitado en Surtec para emitir e-Facturas.

### Pasos

1. BistroLink pide POST /comprobantes/crear con el header X-Emisor (RUT del restaurante), tipo de comprobante 111 (e-Factura), forma de pago contado, moneda UYU, montos con IVA incluido, el id externo del pago, los ítems del pedido y el objeto cliente: tipo de documento 2 (RUT), país UY, número de RUT de 12 dígitos y denominación (razón social).

### Resultado esperado

Surtec responde 200 con id, serie, número, hash, número y vencimiento del CAE y la URL de consulta de DGI. BistroLink devuelve el CFE emitido con esos datos y lo guarda como tipo 111.

## TC-C-016

### Precondición

El RUT del receptor no figura como contribuyente en DGI.

### Pasos

1. BistroLink pide POST /comprobantes/crear de una e-Factura (tipo 111) a ese RUT.

### Resultado esperado

Surtec responde con un error 4xx. BistroLink lanza SurtecError con ese status y sin el RUT ni la razón social del receptor en el mensaje (va a los logs). Con un 4xx, CfeService emite un e-Ticket para que el pago no quede sin comprobante.
