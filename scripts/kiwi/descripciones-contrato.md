# Descripciones de los contratos PactJS (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                            |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 27/10/2026 | TC-C-001 a 009: contratos de Mercado Pago (API Orders y notificación de webhook, BL-215), plan nuevo «Contract-PactJS». |
| 1.1     | 31/10/2026 | TC-C-010 a 014: contratos de Surtec (autenticación y emisión de e-Ticket, BL-216).                                      |

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

## TC-C-010

### Precondición

El usuario de la API de Surtec está habilitado.

### Pasos

1. BistroLink emite un e-Ticket sin tener un token guardado.
2. SurtecClient pide el token con POST /token, grant_type «password», usuario y contraseña.

### Resultado esperado

Surtec responde 200 con access_token y refresh_token. BistroLink usa el access_token como Bearer en la emisión y guarda el refresh_token para renovarlo.

## TC-C-011

### Precondición

El refresh token emitido por Surtec sigue vigente y el access token venció (pasaron las 11 horas de vida que le da BistroLink).

### Pasos

1. BistroLink emite un e-Ticket (login con usuario y contraseña).
2. Pasa el tiempo de vida del token.
3. BistroLink emite otro e-Ticket.

### Resultado esperado

Antes de la segunda emisión, SurtecClient pide POST /token con grant_type «refresh_token» y el refresh token guardado. Surtec responde 200 con un token nuevo y la emisión se hace con ese token, sin volver a mandar la contraseña.

## TC-C-012

### Precondición

El emisor está habilitado en Surtec para emitir e-Tickets.

### Pasos

1. BistroLink pide POST /comprobantes/crear con el header X-Emisor (RUT del restaurante), tipo de comprobante 101 (e-Ticket), forma de pago contado, moneda UYU, montos con IVA incluido, el id externo del pago y los ítems del pedido con IVA tasa básica.

### Resultado esperado

Surtec responde 200 con id, serie, número, hash, número y vencimiento del CAE y la URL de consulta de DGI. BistroLink devuelve el CFE emitido con esos datos.

## TC-C-013

### Precondición

El token de acceso que BistroLink tiene guardado venció del lado de Surtec, y el refresh token sigue vigente.

### Pasos

1. BistroLink pide POST /comprobantes/crear con el token vencido.
2. Surtec responde 401.
3. SurtecClient descarta el token y pide uno nuevo con el refresh token.
4. Repite la misma emisión con el token nuevo.

### Resultado esperado

La segunda emisión responde 200 con el comprobante. BistroLink reintenta una sola vez: un segundo 401 seguido es un error, no un bucle.

## TC-C-014

### Precondición

El emisor no tiene dada de alta en Surtec la sucursal que pide BistroLink (99).

### Pasos

1. BistroLink pide POST /comprobantes/crear con sucursal 99.

### Resultado esperado

Surtec responde con un error 4xx. BistroLink lanza SurtecError con ese status y el cuerpo de la respuesta en el mensaje, sin la contraseña. El pago queda APROBADO sin comprobante y, como un 4xx no es transitorio, no se reintenta en segundo plano: queda para la conciliación (HU-023).
