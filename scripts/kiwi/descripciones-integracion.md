# Descripciones de los casos de integración (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                            |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 24/10/2026 | TC-I-010 a 013 y 055 a 081, cargadas en Kiwi con el script.                                                                                             |
| 1.1     | 27/10/2026 | TC-I-022 a 024 (el pedido llega al KDS al aprobarse el pago, BL-311) y TC-I-082 a 086 (sesión de mesa, HU-017 / BL-60). Cargadas en Kiwi el 27/10/2026. |
| 1.2     | 27/10/2026 | TC-I-082 a 086: la mesa del test pasa de la 97 a la 79 (fuera del rango 80 a 99 de `mesas-layout.e2e-spec.ts`).                                         |
| 1.3     | 27/10/2026 | TC-I-087 a 094 (gestión de establecimientos, BL-404 / BL-416), para cargar con el script antes de mergear el PR.                                        |

Texto del campo de descripción de cada caso TC-I en Kiwi. Lo carga
`cargar-casos-integracion.mjs --descripciones`: cada bloque `## TC-I-NNN`
reemplaza la descripción de ese caso, y solo si cambió. Los casos que no
están en este archivo no se tocan.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`, igual que los casos cargados a mano desde TC-I-029.

## TC-I-010

### Precondición

Tenant, restaurante y mesa de prueba sembrados por el test (mesa número 99). `QR_TOKEN_KEY` configurada.

### Pasos

1. Generar el token del QR de la mesa.
2. `GET /menu/qr/{token}`.

### Resultado esperado

200 OK con el nombre del restaurante sembrado y `mesa: { numero: 99 }`. La respuesta no incluye ids internos.

## TC-I-011

### Precondición

Dos tenants (A y B) con su restaurante y su mesa sembrados.

### Pasos

1. Armar un token de QR, cifrado con la clave real, que combine el tenant A con la mesa del tenant B.
2. `GET /menu/qr/{token}`.

### Resultado esperado

404 Not Found, sin distinguir el motivo. El endpoint es público (sin JWT): si respondiera 200 sería una fuga de datos entre tenants.

## TC-I-012

### Precondición

Tenant A sembrado.

### Pasos

1. Armar un token de QR del tenant A para una mesa que no existe (`00000000-0000-0000-0000-000000000000`).
2. `GET /menu/qr/{token}`.

### Resultado esperado

404 Not Found.

## TC-I-013

### Precondición

Ninguna.

### Pasos

1. `GET /menu/qr/EsteTokenNoLoEmitioElBackend` (un texto que no está cifrado con `QR_TOKEN_KEY`).

### Resultado esperado

404 Not Found: un token que no emitió el backend no da acceso a ningún menú.

## TC-I-022

### Precondición

Mocks de TenantPrismaService y KdsGateway: la mesa existe, el ítem está disponible y el pedido no existe. Pedido para la mesa del QR, con su sesión abierta.

### Pasos

1. Llamar a PedidosService.crear() con observacionGeneral y una observación en una línea.
2. Verificar que todavía no se avisó a cocina.
3. Simular la aprobación del pago: confirmarPagoEnTx() pasa el pedido de PENDIENTE_PAGO a RECIBIDO y notificarPedidoConfirmado() avisa al KDS.

### Resultado esperado

- Al crear el pedido (estado PENDIENTE_PAGO), KdsGateway.emitirNuevoPedido no se llama (prepago, RD.03).
- Después del pago, emitirNuevoPedido se llama una vez con un payload que incluye la observacionGeneral y la observación de la línea correctas.

## TC-I-023

### Precondición

Mismos mocks que TC-I-022, sin observaciones en el pedido.

### Pasos

1. Llamar a PedidosService.crear() sin observacionGeneral ni observación de línea.
2. Verificar que todavía no se avisó a cocina.
3. Simular la aprobación del pago (confirmarPagoEnTx() y notificarPedidoConfirmado()).

### Resultado esperado

- Al crear el pedido, KdsGateway.emitirNuevoPedido no se llama.
- Después del pago, emitirNuevoPedido se llama sin errores, con observacionGeneral y la observación de la línea en undefined: el payload no se rompe.

## TC-I-024

### Precondición

Usuario MOZO de prueba (TEST_MOZO_USERNAME / TEST_MOZO_PASSWORD). Mesa del tenant de prueba con su sesión abierta y token de comensal obtenido con el QR y la sesión de la mesa. Pasarela de pago falsa que aprueba siempre (support/pago-falso.ts): no se conecta a Mercado Pago.

### Pasos

1. Warm-up sin cronometrar: crear un pedido y pagarlo, para no medir el arranque de Prisma y de la conexión.
2. Conectar un socket WebSocket de MOZO y esperar el snapshot.
3. Crear un pedido con POST /pedidos (headers X-Mesa-Token y X-Mesa-Sesion).
4. Pagarlo con POST /pedidos/:id/pagos, cronometrando desde el pago.

### Resultado esperado

El socket del MOZO recibe pedido:nuevo con el id del pedido en menos de 500 ms desde el pago. El pedido llega a cocina recién cuando se aprueba el pago, no al crearlo.

## TC-I-055

### Precondición

Tenant A con su mesa sembrada. `QR_TOKEN_KEY` configurada.

### Pasos

1. Generar el token del QR de la mesa (versión actual).
2. Subir la versión del QR de la mesa, como hace «Regenerar QR» (`POST /mesas/:id/qr/regenerar`).
3. `GET /menu/qr/{token viejo}`.
4. Generar el token nuevo y `GET /menu/qr/{token nuevo}`.

### Resultado esperado

- Con el QR viejo: 410 Gone (el QR fue reemplazado).
- Con el QR nuevo: 200 OK.

## TC-I-056

### Precondición

Tenant A con su mesa sembrada.

### Pasos

1. `GET /menu/{tenantId}/{mesaId}` (la ruta por ids que se usaba antes de BL-204).

### Resultado esperado

404 Not Found: la ruta se retiró. Con los ids en la URL cualquiera podía armar el enlace de otra mesa; ahora el menú de una mesa solo se pide con el token del QR.

## TC-I-057

### Precondición

Keycloak y la base local levantados. Usuario ADMIN de prueba (`TEST_ADMIN_USERNAME` / `TEST_ADMIN_PASSWORD`).

### Pasos

1. El ADMIN da de alta un MOZO con `POST /usuarios`.
2. Lo desactiva con `DELETE /usuarios/:id`.
3. Lo reactiva con `PATCH /usuarios/:id/activar`.
4. Repite la reactivación (doble clic u otra pestaña).

### Resultado esperado

- Después de desactivarlo, la cuenta está deshabilitada en Keycloak.
- La reactivación responde 200 con `{ activo: true, id }`; la fila de `usuario` queda activa y la cuenta habilitada en Keycloak.
- Repetir la reactivación no falla.

## TC-I-058

### Precondición

Usuario ADMIN de prueba del tenant A. Un usuario del tenant B, desactivado directamente en la base y en Keycloak.

### Pasos

1. Con el token del ADMIN del tenant A, `PATCH /usuarios/{id del usuario de B}/activar`.

### Resultado esperado

404 Not Found. El usuario del tenant B sigue desactivado en la base y en Keycloak.

## TC-I-059

### Precondición

Usuario ADMIN de prueba. Un MOZO creado por la API con una contraseña definitiva puesta por la Admin API de Keycloak.

### Pasos

1. El MOZO inicia sesión (password grant).
2. El ADMIN restablece su contraseña con `POST /usuarios/:id/restablecer-contrasena`.
3. Se consultan las sesiones del MOZO en Keycloak.
4. El MOZO intenta ingresar con la contraseña vieja y con la temporal.

### Resultado esperado

- El login del paso 1 responde 200 y el MOZO tiene 1 sesión.
- El restablecimiento responde 200 con `Cache-Control: no-store`, `sesionesCerradas: true` y una contraseña temporal de 16 caracteres.
- El MOZO queda con 0 sesiones.
- Con la contraseña vieja: 400 `invalid_grant` («Invalid user credentials»).
- Con la temporal: 400 «Account is not fully set up»; Keycloak le exige cambiarla (acción `UPDATE_PASSWORD`).

## TC-I-060

### Precondición

Usuario ADMIN de prueba del tenant A. Un usuario del tenant B sin contraseña.

### Pasos

1. Con el token del ADMIN del tenant A, `POST /usuarios/{id del usuario de B}/restablecer-contrasena`.

### Resultado esperado

404 Not Found, sin contraseña temporal en la respuesta. El usuario del tenant B sigue sin ninguna credencial en Keycloak.

## TC-I-061

### Precondición

TC-I-059 ejecutado: existe el MOZO creado en ese caso.

### Pasos

1. El ADMIN desactiva al MOZO con `DELETE /usuarios/:id`.
2. `POST /usuarios/:id/restablecer-contrasena`.

### Resultado esperado

409 Conflict, sin contraseña temporal en la respuesta: no se restablece la contraseña de una cuenta desactivada.

## TC-I-062

### Precondición

Usuario ADMIN de prueba.

### Pasos

1. `POST /usuarios` con nombre «María José» y apellido «Pérez-Núñez».
2. Consultar el usuario en Keycloak (Admin API).
3. `GET /usuarios`.

### Resultado esperado

- La respuesta del alta trae el nombre y el apellido.
- En Keycloak, `firstName` y `lastName` con esos valores.
- El listado devuelve el usuario con su nombre y apellido.

## TC-I-063

### Precondición

Usuario ADMIN de prueba del tenant A. Cada tenant tiene su cuenta de Cocina (solo en Keycloak).

### Pasos

1. `GET /usuarios` con el token del ADMIN del tenant A.

### Resultado esperado

- El listado incluye la cuenta de Cocina del tenant A, marcada como cuenta compartida.
- No incluye la cuenta de Cocina del tenant B.
- El personal (filas de `usuario`) sigue marcado como no compartido.

## TC-I-064

### Precondición

Usuario ADMIN de prueba del tenant A y una cuenta de Cocina temporal de ese tenant.

### Pasos

1. `DELETE /usuarios/cocina/:keycloakId` (desactivar).
2. `PATCH /usuarios/cocina/:keycloakId/activar` (reactivar).
3. `POST /usuarios/cocina/:keycloakId/restablecer-contrasena`.

### Resultado esperado

- Después del paso 1 la cuenta está deshabilitada en Keycloak; después del paso 2, habilitada.
- El restablecimiento responde 200 con `Cache-Control: no-store` y una contraseña temporal de 16 caracteres; Keycloak exige cambiarla en el primer ingreso.

## TC-I-065

### Precondición

Usuario ADMIN de prueba del tenant A. La cuenta de Cocina del tenant B.

### Pasos

1. Con el token del ADMIN del tenant A, `POST /usuarios/cocina/{cocina de B}/restablecer-contrasena`.
2. `DELETE /usuarios/cocina/{cocina de B}`.

### Resultado esperado

Las dos acciones responden 404 Not Found. La cuenta de Cocina del tenant B queda igual: mismo estado y sin acciones pendientes nuevas.

## TC-I-066

### Precondición

Usuario ADMIN de prueba.

### Pasos

1. `POST /usuarios` para crear un usuario.
2. `PATCH /usuarios/:id` con nombre y correo nuevos.
3. Consultar el usuario en Keycloak y en `GET /usuarios`.

### Resultado esperado

200 OK con los datos nuevos. Keycloak y el listado muestran el nombre y el correo nuevos.

## TC-I-067

### Precondición

TC-I-066 ejecutado: existe el usuario creado en ese caso.

### Pasos

1. `PATCH /usuarios/:id` con el correo de otro usuario (el del ADMIN de prueba).

### Resultado esperado

409 Conflict con el mensaje «Ya hay otro usuario con ese correo». El correo del usuario no cambia en la base.

## TC-I-068

### Precondición

Usuario ADMIN de prueba del tenant A y su cuenta de Cocina.

### Pasos

1. `PATCH /usuarios/{keycloakId de la cuenta de Cocina}`.

### Resultado esperado

404 Not Found: la cuenta de Cocina no es una fila de `usuario` y no se edita por esta ruta.

## TC-I-069

### Precondición

Usuario ADMIN de prueba. Un MOZO creado por la API con una contraseña definitiva puesta por la Admin API de Keycloak.

### Pasos

1. El MOZO inicia sesión (password grant) y obtiene su refresh token.
2. El ADMIN cierra sus sesiones con `POST /usuarios/:id/cerrar-sesiones`.
3. Se consultan las sesiones del MOZO en Keycloak y se intenta renovar su refresh token.

### Resultado esperado

- Antes del paso 2 el MOZO tiene 1 sesión.
- Respuesta 200 con `{ id, sesionesCerradas: true }`.
- El MOZO queda con 0 sesiones y la renovación responde 400 `invalid_grant`.
- La cuenta sigue activa en Keycloak y en la base.

## TC-I-070

### Precondición

Usuario ADMIN de prueba del tenant A. La cuenta de Cocina del tenant B.

### Pasos

1. Con el token del ADMIN del tenant A, `POST /usuarios/cocina/{cocina de B}/cerrar-sesiones`.

### Resultado esperado

404 Not Found.

## TC-I-071

### Precondición

Usuario ADMIN de prueba. La cuenta de servicio del backend tiene el rol `view-events` en Keycloak.

### Pasos

1. El ADMIN obtiene su token (password grant: Keycloak registra un evento LOGIN).
2. `GET /usuarios`.

### Resultado esperado

El ADMIN aparece en el listado con `ultimoIngreso` igual a la hora de ese ingreso (con un margen de 5 segundos por diferencias de reloj).

## TC-I-072

### Precondición

Usuario ADMIN de prueba.

### Pasos

1. `DELETE /usuarios/{su propio id}`.

### Resultado esperado

403 Forbidden. El ADMIN sigue activo.

## TC-I-073

### Precondición

Usuario ADMIN de prueba.

### Pasos

1. `PATCH /usuarios/{su propio id}` para cambiarse el rol.
2. `POST /usuarios/{su propio id}/cerrar-sesiones`.

### Resultado esperado

Las dos acciones responden 403 Forbidden. Sigue siendo ADMIN y su token sigue sirviendo.

## TC-I-074

### Precondición

Usuario ADMIN de prueba. Un MOZO recién creado, sin pedidos ni otro historial.

### Pasos

1. `GET /usuarios`: el MOZO aparece sin historial.
2. `DELETE /usuarios/:id/permanente`.

### Resultado esperado

200 OK con `{ eliminado: true, id }`. El usuario ya no existe en Keycloak (404) ni en la tabla `usuario`.

## TC-I-075

### Precondición

Usuario ADMIN de prueba. Un MOZO con un pedido tomado por él en una mesa de prueba.

### Pasos

1. `DELETE /usuarios/:id/permanente`.

### Resultado esperado

409 Conflict: lo que tiene historial no se borra. El usuario sigue en Keycloak y en la tabla, sin cambios.

## TC-I-076

### Precondición

Usuario ADMIN de prueba.

### Pasos

1. Buscar su propia fila en `GET /usuarios`.
2. `DELETE /usuarios/{su propio id}/permanente`.

### Resultado esperado

403 Forbidden: el ADMIN no puede eliminarse a sí mismo.

## TC-I-077

### Precondición

Usuario COCINA de prueba.

### Pasos

1. `POST /admin/menu/presigned-url` con una imagen PNG de 1 KB.

### Resultado esperado

403 Forbidden: solo el ADMIN sube imágenes de la carta. No se pide ninguna URL a S3.

## TC-I-078

### Precondición

Usuario MOZO de prueba.

### Pasos

1. `POST /admin/menu/presigned-url` con una imagen PNG de 1 KB.

### Resultado esperado

403 Forbidden. No se pide ninguna URL a S3.

## TC-I-079

### Precondición

Usuario MOZO de prueba.

### Pasos

1. `POST /admin/menu/imagenes/confirmar` con una key.

### Resultado esperado

403 Forbidden: solo el ADMIN confirma imágenes.

## TC-I-080

### Precondición

Usuario ADMIN de prueba del tenant A.

### Pasos

1. `POST /admin/menu/imagenes/confirmar` con una key de una imagen de otro tenant.

### Resultado esperado

400 Bad Request con el mensaje «La imagen no es válida para este establecimiento»: la key no es del tenant del token. No se accede a S3.

## TC-I-081

### Precondición

Usuario ADMIN de prueba.

### Pasos

1. Enviar 21 pedidos seguidos a `POST /admin/menu/imagenes/confirmar`.

### Resultado esperado

Al menos uno responde 429 Too Many Requests: el límite es de 20 por minuto y por usuario.

## TC-I-082

### Precondición

Mesa propia del test (número 79 del tenant A) en estado LIBRE, sin sesión abierta. QR_TOKEN_KEY configurada (si falta, el test usa una clave aleatoria).

### Pasos

1. Generar el token del QR de la mesa.
2. GET /menu/qr/{token}.

### Resultado esperado

410 Gone con codigo MESA_CERRADA: con la mesa cerrada, el QR no abre la carta.

## TC-I-083

### Precondición

TC-I-082 ejecutado: la mesa 79 está LIBRE. Usuario MOZO de prueba (TEST_MOZO_USERNAME / TEST_MOZO_PASSWORD); si faltan las variables, el caso se saltea.

### Pasos

1. Conectar un socket WebSocket con el token del MOZO y esperar el snapshot.
2. POST /mesas/{id}/abrir con el token del MOZO, cronometrando.
3. GET /menu/qr/{token}.
4. POST /auth/comensal/mesa con el token del QR y la sesionMesa devuelta en el paso 3.

### Resultado esperado

- El paso 2 responde 200 con estado OCUPADA.
- El socket recibe mesa:estado_actualizado de esa mesa con estado OCUPADA en menos de 1 s.
- El QR abre la carta (200) y la respuesta trae sesionMesa.
- Con esa sesión, el comensal obtiene su token (200).

## TC-I-084

### Precondición

TC-I-083 ejecutado: la mesa 79 está abierta. Se crea en la base un pedido de esa mesa en estado EN_PREPARACION.

### Pasos

1. POST /mesas/{id}/cerrar con el token del MOZO.
2. GET /menu/qr/{token}.

### Resultado esperado

- El cierre responde 409 Conflict con un mensaje que indica pedidos sin entregar.
- La mesa sigue abierta: el QR abre la carta (200).
- Al terminar, el test pasa el pedido a ENTREGADO.

## TC-I-085

### Precondición

TC-I-084 ejecutado: la mesa 79 está abierta y sus pedidos están entregados. Se guarda la sesionMesa vigente y se crea en la base un pedido de esa mesa en PENDIENTE_PAGO.

### Pasos

1. POST /mesas/{id}/cerrar con el token del MOZO.
2. Consultar en la base el estado del pedido sin pagar.
3. GET /menu/qr/{token}.
4. POST /auth/comensal/mesa con el token del QR y la sesionMesa guardada antes del cierre.

### Resultado esperado

- El cierre responde 200: la mesa queda en REQUIERE_LIMPIEZA y pedidosCancelados = 1.
- El pedido sin pagar queda CANCELADO.
- El QR ya no abre la carta: 410 con codigo MESA_CERRADA.
- La sesión anterior no da token de comensal: 410 con codigo MESA_CERRADA.

## TC-I-086

### Precondición

TC-I-085 ejecutado: la mesa 79 está en REQUIERE_LIMPIEZA.

### Pasos

1. POST /mesas/{id}/abrir sin marcarla limpia.
2. POST /mesas/{id}/limpia y después POST /mesas/{id}/abrir.
3. GET /menu/qr/{token} y POST /auth/comensal/mesa con la sesionMesa nueva.
4. POST /auth/comensal/mesa con una sesionMesa vieja.
5. POST /pedidos con el token de comensal de la sesión nueva, X-Mesa-Token y X-Mesa-Sesion con la sesión vieja.
6. Cerrar y marcar limpia la mesa (limpieza del test).

### Resultado esperado

- Paso 1: 409 Conflict (la mesa requiere limpieza primero).
- Paso 2: limpia responde 200 con estado LIBRE y abrir responde 200.
- Paso 3: la sesión nueva da token de comensal (200).
- Pasos 4 y 5: 410 con codigo SESION_VENCIDA: la sesión de una página vieja no sirve ni para el token ni para pedir.

## TC-I-087

### Precondición

Usuario PLATAFORMA del test y un establecimiento dado de alta por la API. Admin del seed (`TEST_ADMIN_USERNAME` / `TEST_ADMIN_PASSWORD`).

### Pasos

1. Pedir un token del Admin del seed.
2. Con ese token, llamar a cada ruta de gestión del establecimiento: ver la ficha, editar, suspender, reactivar, agregar Administrador, restablecer contraseña y eliminar.

### Resultado esperado

403 en todas. El establecimiento no cambia (misma razón social y RUT).

## TC-I-088

### Precondición

Usuario PLATAFORMA del test y un establecimiento dado de alta por la API.

### Pasos

1. Dar de alta un establecimiento con un RUT con el dígito verificador equivocado.
2. Editar el RUT del establecimiento con un dígito verificador equivocado.
3. Editar el RUT del establecimiento con el RUT de otro establecimiento.

### Resultado esperado

1. 400 y no se crea ningún tenant con ese RUT.
2. 400.
3. 409. El establecimiento conserva su RUT.

## TC-I-089

### Precondición

Usuario PLATAFORMA del test y un establecimiento recién dado de alta, sin pedidos.

### Pasos

1. `GET /plataforma/establecimientos/:tenantId`.
2. `GET /plataforma/establecimientos?q=<RUT>`.

### Resultado esperado

1. 200: estado ACTIVO, `eliminable: true` y el Administrador con su id. La respuesta no tiene contraseñas.
2. 200: el establecimiento aparece con `eliminable: true`.

## TC-I-090

### Precondición

Usuario PLATAFORMA del test y un establecimiento activo, con contraseñas definitivas para su Admin y su Cocina.

### Pasos

1. Pedir tokens del Admin, la Cocina y el comensal técnico, y comprobar que funcionan, igual que el menú público.
2. Suspender el establecimiento con un motivo.
3. Usar los tokens del paso 1, abrir el menú público y pedir un token de comensal.
4. Reactivar y volver a ingresar con el Admin.

### Resultado esperado

1. 200 con los tres tokens y en el menú público.
2. 200, estado SUSPENDIDO con el motivo.
3. 403 con el código ESTABLECIMIENTO_SUSPENDIDO para los tres tokens y el menú público (sin el motivo ni la palabra «suspendido»); 403 al pedir el token de comensal.
4. 200, estado ACTIVO; el Admin y el menú vuelven a funcionar.

## TC-I-091

### Precondición

Usuario PLATAFORMA del test, un establecimiento dado de alta por la API y el Admin del seed (de otro establecimiento).

### Pasos

1. Restablecer la contraseña del Admin del seed usando el id del establecimiento del test.
2. Pedir un token del Admin del seed con su contraseña de siempre.
3. Restablecer la contraseña del Administrador del establecimiento del test.

### Resultado esperado

1. 404.
2. Funciona: su contraseña no cambió.
3. 200 con la contraseña temporal y `Cache-Control: no-store`; la contraseña anterior ya no sirve.

## TC-I-092

### Precondición

Usuario PLATAFORMA del test y un establecimiento dado de alta por la API.

### Pasos

1. Agregar un Administrador en un establecimiento que no existe.
2. Agregar el mismo Administrador en el establecimiento del test.

### Resultado esperado

1. 404 y no se crea en Keycloak.
2. 201 con la contraseña temporal y `Cache-Control: no-store`; la fila de `usuario` y el atributo `tenant_id` de Keycloak son de ese establecimiento.

## TC-I-093

### Precondición

Usuario PLATAFORMA del test y un establecimiento dado de alta por la API, con un pedido (cancelado) cargado en la base.

### Pasos

1. Ver la ficha.
2. Eliminar con el RUT correcto.
3. Eliminar con un RUT equivocado.

### Resultado esperado

1. `eliminable: false`.
2. 409 con «suspendelo».
3. 400.

No se borra nada: siguen el tenant, el restaurante, los usuarios y las cuentas de Keycloak.

## TC-I-094

### Precondición

Usuario PLATAFORMA del test y un establecimiento sin pedidos, con un Administrador agregado.

### Pasos

1. Eliminar con el RUT correcto.
2. Buscar en la base y en Keycloak lo del establecimiento, y pedir el token del comensal técnico.
3. Ver la ficha y repetir la eliminación.

### Resultado esperado

1. 200: `datosEliminados: true` y ninguna cuenta pendiente (al menos 4 borradas).
2. No queda el tenant, ni el restaurante, ni usuarios, ni mesas; ninguna de sus cuentas existe en Keycloak y el comensal ya no obtiene token.
3. 404 en los dos casos.
