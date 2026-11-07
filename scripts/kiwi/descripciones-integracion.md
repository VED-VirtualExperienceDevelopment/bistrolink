# Descripciones de los casos de integración (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                                                                                                              |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 24/10/2026 | TC-I-010 a 013 y 055 a 081, cargadas en Kiwi con el script.                                                                                                                                                                               |
| 1.1     | 27/10/2026 | TC-I-022 a 024 (el pedido llega al KDS al aprobarse el pago, BL-311) y TC-I-082 a 086 (sesión de mesa, HU-017 / BL-60). Cargadas en Kiwi el 27/10/2026.                                                                                   |
| 1.2     | 27/10/2026 | TC-I-082 a 086: la mesa del test pasa de la 97 a la 79 (fuera del rango 80 a 99 de `mesas-layout.e2e-spec.ts`).                                                                                                                           |
| 1.3     | 27/10/2026 | TC-I-087 a 094 (gestión de establecimientos, BL-404 / BL-416), para cargar con el script antes de mergear el PR.                                                                                                                          |
| 1.4     | 27/10/2026 | TC-I-095 a 098 (vencimiento y conciliación de pagos, HU-032 / BL-202).                                                                                                                                                                    |
| 1.5     | 27/10/2026 | Se recupera el contenido que se perdió en el merge de BL-435 (TC-I-010 a 098). TC-I-099 a 108: CRUD de la carta (HU-005, BL-52/BL-53), antes `[TC-E-…]`.                                                                                  |
| 1.6     | 28/10/2026 | TC-I-113 a 117 (cobro en efectivo, HU-031 / BL-201), para cargar con el script antes de mergear el PR.                                                                                                                                    |
| 1.7     | 28/10/2026 | TC-I-118 a 121 (solicitud de pago en efectivo del comensal, HU-031b / BL-442), para cargar con el script antes de mergear el PR.                                                                                                          |
| 1.8     | 28/10/2026 | TC-I-122 a 125 (pedido cargado por el mozo, HU-039 / BL-209), para cargar con el script antes de mergear el PR.                                                                                                                           |
| 1.9     | 31/10/2026 | TC-I-106 y 107: DELETE pasa a eliminar definitivamente (BL-394). TC-I-126 a 131: Gestión de Carta (BL-392 / BL-402).                                                                                                                      |
| 1.10    | 01/11/2026 | TC-I-132 a 135 (configuración del establecimiento, HU-020 / BL-72), para cargar con el script antes de mergear el PR.                                                                                                                     |
| 1.11    | 01/11/2026 | TC-I-133 y 135: Plexo queda fuera del MVP, igual que Handy (BL-452).                                                                                                                                                                      |
| 1.12    | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-136 y 137: avisos de efectivo pendientes en el KDS (BL-448), para cargar con el script antes de mergear el PR.                                                               |
| 1.13    | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-138: rebaja de IVA de la Ley 17.934 en el estado del pago (HU-037 / BL-207), para cargar con el script antes de mergear el PR.                                               |
| 1.14    | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-139: datos del establecimiento para la política de privacidad (HU-036 / BL-206), para cargar con el script antes de mergear el PR.                                           |
| 1.15    | 02/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-140 y 141: e-Factura con RUT y razón social, consentimiento y anonimización (HU-009 / BL-453), para cargar con el script antes de mergear el PR.                             |
| 1.16    | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-142 y 143: estado de los CFE ante la DGI y listado de comprobantes del administrador (HU-009 / BL-455), para cargar con el script antes de mergear el PR.                    |
| 1.17    | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-144 a 152: dashboard de reportes de ventas y resumen por hora (HU-012 / BL-108, BL-109, BL-110 y BL-219), para cargar con el script antes de mergear el PR.                  |
| 1.18    | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-153 a 160: stock de la jornada, alertas de stock bajo y descuento al confirmar el pago (HU-015 / BL-120, BL-121 y BL-122), para cargar con el script antes de mergear el PR. |
| 1.19    | 04/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-161 y 162: conciliación de CFE pendientes y pendientes de emisión del administrador (HU-023 / BL-96), para cargar con el script antes de mergear el PR.                      |
| 1.20    | 06/11/2026 | TC-I-164 a 167: cola del KDS y límite de pedidos en preparación (HU-042 / BL-467), para cargar con el script antes de mergear el PR.                                                                                                      |
| 1.21    | 07/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-168 a 174: limpieza de los datos de prueba (BL-285 / BL-476, ADR 0011), para cargar con el script antes de mergear el PR.                                                    |
| 1.22    | 07/11/2026 | TC-I-175 y 176: PDF del comprobante y su copia en S3 (HU-009 / BL-454), para cargar con el script antes de mergear el PR.                                                                                                                 |

Texto del campo de descripción de cada caso TC-I en Kiwi. Lo carga
`cargar-casos-integracion.mjs --descripciones`: cada bloque `## TC-I-NNN`
reemplaza la descripción de ese caso, y solo si cambió. Los casos que no
están en este archivo no se tocan.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`, igual que los casos cargados a mano desde TC-I-029.

## Casos para cargar

## TC-I-168

### Precondición

Módulo de limpieza habilitado (`E2E_CLEANUP_ENABLED=true`). Token del Admin del tenant A. Tres pedidos propios del test en la mesa 1: uno en `PENDIENTE_PAGO` con aviso de efectivo y dos en `RECIBIDO`.

### Pasos

1. `POST /testing/limpieza` con el área `pedidos`, los ids de los dos primeros pedidos y `dryRun: true`.
2. Repetir sin `dryRun`.
3. Leer los pedidos, el historial de estados y la auditoría.

### Resultado esperado

1. 200 con un pedido por estado encontrado (uno a cancelar y uno a entregar). Ningún pedido cambia.
2. 200.
3. El pedido sin pagar queda `CANCELADO` y el pagado `ENTREGADO`, cada uno con su fila en el historial; el tercero sigue en `RECIBIDO`. Hay un registro `PEDIDO_LIMPIEZA_PRUEBAS` con los ids. No se borró ninguna fila.

## TC-I-169

### Precondición

Módulo de limpieza habilitado. Token del Admin del tenant A. Una mesa temporal número 77, la mesa 2 en `REQUIERE_LIMPIEZA` y dos zonas en el plano: «Zona E2E …» y «Patio …».

### Pasos

1. `POST /testing/limpieza` con el área `mesas`.
2. Leer las mesas y el plano.

### Resultado esperado

1. 200 con al menos una mesa eliminada y una zona quitada.
2. La mesa 77 ya no existe. La mesa 2 está `OCUPADA` con sesión nueva (como el seed). El plano conserva «Patio …» y no tiene «Zona E2E …».

## TC-I-170

### Precondición

Módulo de limpieza habilitado. Token del Admin del tenant A. Una categoría «E2E carta …» con un ítem, un ítem «Flan casero …» en Platos principales y la Milanesa con precio 600 y control de stock con 3 unidades.

### Pasos

1. `POST /testing/limpieza` con el área `carta`.
2. Leer la carta.

### Resultado esperado

1. 200 con al menos un ítem y una categoría eliminados.
2. La categoría «E2E carta …» y su ítem ya no existen. «Flan casero …» no cambió. La Milanesa vuelve a 590, sin control de stock y con stock 0.

## TC-I-171

### Precondición

Módulo de limpieza habilitado. Token del Admin del tenant A. Configuración del restaurante cambiada (Mercado Pago apagado, propinas 10 y 15, cola con límite 3) y un usuario «e2e-limpieza-…» creado por la API (base y Keycloak).

### Pasos

1. `POST /testing/limpieza` con las áreas `configuracion` y `usuarios`.
2. Leer la configuración, el usuario en la base y en Keycloak, y pedir un token del Admin del seed.

### Resultado esperado

1. 200: los campos cambiados figuran como restablecidos (el correo de privacidad no) y al menos un usuario eliminado, sin errores.
2. Mercado Pago encendido, sin propinas y cola apagada; el correo de privacidad no cambió. El usuario «e2e-limpieza-…» no existe en la base ni en Keycloak. El Admin del seed sigue entrando.

## TC-I-172

### Precondición

Módulo de limpieza habilitado. Usuarios Admin y Mozo del seed.

### Pasos

1. `POST /testing/limpieza` sin token.
2. Lo mismo con el token del Mozo.
3. `POST /testing/limpieza/establecimientos` con el token del Admin.
4. `POST /testing/limpieza` con el token del Admin y un área que no existe.

### Resultado esperado

1. 401.
2. 403.
3. 401 o 403: la ruta es solo para el rol PLATAFORMA.
4. 400.

## TC-I-173

### Precondición

Módulo de limpieza habilitado. Usuario PLATAFORMA del test. Un establecimiento «E2E Plataforma …» dado de alta por la API, sin pedidos (con su Admin y su cuenta de Cocina en Keycloak).

### Pasos

1. `POST /testing/limpieza/establecimientos` con `dryRun: true`.
2. Repetir sin `dryRun`.
3. Buscar el establecimiento y el tenant A en la base, y las cuentas del alta en Keycloak.

### Resultado esperado

1. 200 con al menos un establecimiento a eliminar. Las cuentas siguen en Keycloak.
2. 200, sin errores.
3. El establecimiento ya no existe; el tenant A sí. Las cuentas del alta ya no están en Keycloak.

## TC-I-174

### Precondición

API levantada **sin** `E2E_CLEANUP_ENABLED` (como en producción).

### Pasos

1. `POST /testing/limpieza`.
2. `POST /testing/limpieza/establecimientos`.

### Resultado esperado

1. 404: la ruta no existe.
2. 404.

## TC-I-175

### Precondición

Tenant A del seed. Un pedido pagado con su e-Factura de Surtec y otro pagado sin comprobante. Surtec falso: devuelve un PDF mínimo.

### Pasos

1. Pedir el PDF del comprobante por el pedido (como el comensal) y por el comprobante (como el administrador).
2. Pedir el PDF del pedido sin comprobante.
3. Pedir los dos PDF desde el tenant B.

### Resultado esperado

1. Se recibe el PDF en base64 con el nombre «e-Factura-<serie>-<número>.pdf», pedido a Surtec con el RUT del local y el id de Surtec del comprobante.
2. 404.
3. 404 (RLS). Ninguno de los pedidos de los pasos 2 y 3 llega a Surtec.

## TC-I-176

### Precondición

Tenant A del seed. Dos pedidos pagados con su e-Ticket de Surtec, emitidos hace 10 minutos. Surtec falso (devuelve un PDF mínimo, salvo para el segundo comprobante, donde falla) y S3 en memoria.

### Pasos

1. Correr el respaldo del PDF para el tenant B.
2. Correr el respaldo del PDF para el tenant A.
3. Volver a correrlo enseguida.
4. Descargar el PDF del primer comprobante como administrador.

### Resultado esperado

1. No pide a Surtec ningún comprobante del tenant A (RLS).
2. El PDF del primero queda en S3 con la clave «<tenant_id>/cfe/<año>/<mes>/<id>.pdf», y en la base quedan esa clave y el SHA-256 del archivo. El segundo queda sin clave y con 1 intento.
3. No vuelve a pedir ninguno: el primero ya está guardado y el segundo espera 5 minutos antes de reintentar.
4. Se recibe el PDF guardado sin llamar a Surtec.
