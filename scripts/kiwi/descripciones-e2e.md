# Descripciones de los casos E2E (Kiwi TCMS)

Plantilla para cargar en Kiwi la descripción de casos TC-E (Playwright)
nuevos o que cambiaron (BL-435). La usa
`cargar-casos-integracion.mjs --e2e --descripciones`.

## Cómo se usa

1. Agregar al final de este archivo un bloque por caso, con el formato del
   ejemplo de abajo (sin la sangría): un encabezado `## TC-E-NNN` en su
   propia línea y debajo `### Precondición`, `### Pasos` y
   `### Resultado esperado`.
2. Ver qué va a cambiar:
   `node scripts/kiwi/cargar-casos-integracion.mjs --e2e --descripciones`
3. Cargar:
   `node scripts/kiwi/cargar-casos-integracion.mjs --e2e --aplicar --descripciones`
4. Verificar con el comando del paso 2: tiene que decir «0 para actualizar».

El script reemplaza la descripción de cada caso que tenga un bloque acá, y
solo si cambió. Los casos sin bloque no se tocan. Una vez cargados, los
bloques se pueden borrar de este archivo: la descripción queda en Kiwi, que
es donde se consulta.

Reglas:

- El caso tiene que existir en el Test Plan «E2E-Playwright». Si es nuevo,
  el mismo comando con `--aplicar` lo crea antes de cargar la descripción.
- Sin credenciales, URLs de entornos ni datos personales: el repositorio es
  público.

## Ejemplo

    ## TC-E-040

    ### Precondición
    Usuario de prueba y datos que necesita el test.

    ### Pasos
    1. Lo que hace el test en la pantalla.

    ### Resultado esperado
    Lo que tiene que verse.

## Casos para cargar

## TC-E-004

### Precondición

Ninguna. Un QR con formato válido que el backend nunca emitió.

### Pasos

1. Abrir `/q/` con ese QR.

### Resultado esperado

Se muestra «No encontramos el menú para esta mesa» (la API responde 404 porque el QR no se puede descifrar).

## TC-E-010

### Precondición

Ítem disponible en el seed. Sandbox de Mercado Pago con la tarjeta de prueba (titular APRO).

### Pasos

1. Abrir el menú por el link web del local.
2. Agregar el ítem disponible al carrito.
3. «Continuar al pago» y pagar con la tarjeta de prueba.

### Resultado esperado

Se ve «¡Tu pedido ya está en cocina!», el carrito se vacía y el seguimiento marca el paso «Recibido» como actual.

## TC-E-017

### Precondición

QR de la mesa 1 del seed (fixture `qrMesas`). Sesión de mozo para cerrar el pedido al final. Sandbox de Mercado Pago con la tarjeta de prueba (titular APRO).

### Pasos

1. Abrir el menú desde la URL del QR y agregar el ítem disponible.
2. «Continuar al pago».
3. Pagar con la tarjeta de prueba.

### Resultado esperado

2. El token del comensal responde 200 y el pedido 201; el pedido lleva el QR en `X-Mesa-Token` y el cuerpo no trae `mesaId` ni `restauranteId`.
3. El pago también lleva el QR; se ve «¡Tu pedido ya está en cocina!», el carrito se vacía y el seguimiento marca «Recibido».
   Al final, el pedido se entrega desde el KDS para no dejarlo abierto.

## TC-E-018

### Precondición

Igual que TC-E-017, con el KDS abierto con el usuario Mozo.

### Pasos

1. Desde el QR de la mesa 1, agregar el ítem, «Continuar al pago» y pagar con la tarjeta de prueba.
2. Buscar el ticket del pedido en el KDS.
3. Entregar el pedido desde el KDS.

### Resultado esperado

2. El ticket aparece en menos de 5 s con «Mesa 1» (el número sale del QR, no del navegador).
3. El pedido queda entregado.

## TC-E-019

### Precondición

El enlace viejo de la mesa 1 por ids (`/m/<tenant>/<mesa>`), anterior al QR opaco.

### Pasos

1. Abrir el enlace viejo.

### Resultado esperado

Se ve «Este enlace ya no se usa.» y el menú no se muestra.

## TC-E-020

### Precondición

Usuario Administrador del tenant de testing A. El test guarda el plano que había y lo restaura al final, aunque falle.

### Pasos

1. En `/admin/mesas`, «Agregar zona» con un nombre único y agregar una «Puerta».
2. «Guardar mapa».
3. Recargar el mapa.
4. Abrir «Ver el plano como lista».

### Resultado esperado

1. Aparece «Cambios sin guardar».
2. Se ve «Guardado ✓».
3. La zona y la puerta vuelven con la misma posición, tamaño y rotación que se guardaron, sin cambios pendientes.
4. La lista muestra la zona con su cantidad de mesas.

## TC-E-021

### Precondición

Usuario Mozo (Colaborador) del tenant de testing A.

### Pasos

1. Abrir `/admin/mesas`.
2. Abrir «Ver el plano como lista».

### Resultado esperado

1. Se ve el aviso de modo solo lectura, sin «Agregar zona» ni «Guardar mapa».
2. La lista muestra la misma cantidad de zonas y de elementos fijos que devuelve la API.

## TC-E-022

### Precondición

Usuario Administrador del tenant de testing A.

### Pasos

1. Abrir `/admin/mesas` y «Ver el plano como lista».
2. Analizar `main` con axe-core (WCAG 2.1 AA).

### Resultado esperado

Ninguna violación critical ni serious.

## TC-E-023

### Precondición

Ninguna (sin sesión). Corre en chromium y desktop-safari.

### Pasos

1. Abrir `/login`.
2. Analizar la página con axe-core (WCAG 2.1 AA).

### Resultado esperado

1. Se ve el título «Ingresá a BistroLink», el botón «Ingresar» y el enlace «Volver al inicio».
2. Ninguna violación critical ni serious.

## TC-E-024

### Precondición

Realm de staging con el español activado y el tema de BistroLink. Corre en chromium y desktop-safari.

### Pasos

1. Entrar a `/kds` sin sesión y tocar «Ingresar» para llegar al login de Keycloak.
2. Analizar la página con axe-core (WCAG 2.1 AA).

### Resultado esperado

1. La página está en español (`lang="es"`), con el título «Ingresá a BistroLink», los campos «Usuario o correo» y «Contraseña» y el botón «Ingresar».
2. Ninguna violación critical ni serious.

## TC-E-025

### Precondición

Sesión de Administrador en el KDS. No corre en WebKit.

### Pasos

1. Ubicar en el encabezado el botón del usuario (Administrador).
2. Darle foco y presionar Enter.
3. Presionar Escape.

### Resultado esperado

1. El botón se ve, cerrado (`aria-expanded="false"`).
2. Se abre y muestra «Cerrar sesión».
3. Se cierra, «Cerrar sesión» deja de verse y el foco vuelve al botón.

## TC-E-026

### Precondición

Sesión de Mozo. No corre en WebKit.

### Pasos

1. Abrir `/admin/mesas`.

### Resultado esperado

El encabezado muestra el botón del usuario con el rol Mozo.

## TC-E-027

### Precondición

Ninguna (sin sesión). Corre en chromium, mobile-chrome, mobile-safari y desktop-safari.

### Pasos

1. Abrir la landing (`/`).
2. Desplazarse hasta el pie de página.
3. Tocar «Ingresar» del encabezado.

### Resultado esperado

1. «Ingresar» se ve en el encabezado.
2. Sigue visible (encabezado fijo).
3. Lleva a `/login`.

## TC-E-028

### Precondición

Ninguna (sin sesión).

### Pasos

1. Con la ventana en 360 × 740 px, abrir la landing.

### Resultado esperado

La página no tiene scroll horizontal (el ancho del documento no supera el de la ventana).

## TC-E-029

### Precondición

Ninguna (sin sesión).

### Pasos

1. Con la ventana en 1280 × 800 px, abrir la landing.

### Resultado esperado

El panel «Buscá el código QR de tu mesa» queda a la derecha del título del hero, no debajo.

## TC-E-030

### Precondición

Ninguna (sin sesión). Corre en los cuatro proyectos.

### Pasos

1. Abrir la landing.
2. Analizar la página con axe-core (WCAG 2.1 AA).

### Resultado esperado

Ninguna violación critical ni serious.

## TC-E-031

### Precondición

Usuario Administrador del tenant de testing A. El test crea su propio usuario por la API, lo desactiva y lo elimina al final.

### Pasos

1. En `/admin/usuarios`, filtrar «Inactivos» y buscar el usuario.
2. «Reactivar» desde su fila y confirmar.
3. Filtrar «Activos».

### Resultado esperado

1. La fila dice «Desactivado».
2. El diálogo se cierra.
3. La fila dice «Activo».

## TC-E-032

### Precondición

Usuario Administrador. El test crea su propio usuario por la API y lo elimina al final.

### Pasos

1. Buscar el usuario y «Restablecer la contraseña».
2. Confirmar con «Restablecer».
3. «Listo».

### Resultado esperado

2. Se muestra una contraseña temporal (8 caracteres o más), una sola vez, y el foco va a «Copiar».
3. El diálogo se cierra.

## TC-E-033

### Precondición

Usuario Administrador. El test crea su propio usuario por la API y lo elimina al final.

### Pasos

1. Buscar por el nombre de usuario.
2. Vaciar la búsqueda y filtrar por el rol «Cocina».
3. Desactivar el usuario por la API y buscarlo con «Activos» y con «Inactivos».

### Resultado esperado

1. Una sola fila y se anuncia «1 usuario».
2. Todas las filas son de la cuenta compartida de cocina.
3. Con «Activos», «No hay usuarios con esos filtros»; con «Inactivos», aparece.

## TC-E-034

### Precondición

Usuario Administrador. El test crea su propio usuario por la API y lo elimina al final.

### Pasos

1. Buscar el usuario y «Editar».
2. Cambiar nombre, apellido y correo, y «Guardar cambios».

### Resultado esperado

El diálogo se cierra y la fila muestra el nombre, el apellido y el correo nuevos.

## TC-E-035

### Precondición

Usuario Administrador. El test crea su propio usuario por la API y lo elimina al final.

### Pasos

1. Buscar el usuario y «Cerrar las sesiones».
2. Confirmar con «Cerrar sesiones».
3. «Entendido».

### Resultado esperado

2. El resultado se anuncia («se cerraron las sesiones») y el foco va a «Entendido».
3. La fila sigue diciendo «Activo».

## TC-E-036

### Precondición

Usuario Administrador. No cambia datos.

### Pasos

1. Ubicar la fila propia (marcada «(vos)»).
2. Dar foco a «Desactivar» y presionar Enter.
3. Abrir «Editar» de la fila propia y cancelar.

### Resultado esperado

1. Hay una sola; no ofrece «Eliminar» y «Cerrar sesiones» está marcado como no disponible.
2. «Desactivar» recibe el foco, está marcado como no disponible y no abre ningún diálogo.
3. El campo «Rol» está deshabilitado y se explica «No podés cambiar tu propio rol».

## TC-E-037

### Precondición

Usuario Administrador. El test crea su propio usuario por la API (sin historial). Para la segunda parte, algún usuario con historial en el entorno.

### Pasos

1. Buscar el usuario nuevo y «Eliminar».
2. Confirmar con «Eliminar».
3. Buscar un usuario con historial.

### Resultado esperado

1. El foco empieza en «Cancelar».
2. El usuario deja de aparecer, también con «Todos».
3. Su fila no ofrece «Eliminar». Si el entorno no tiene usuarios con historial, el reporte lo anota y esta parte no se comprueba.

## TC-E-038

### Precondición

Usuario Administrador. No cambia datos.

### Pasos

1. Analizar `/admin/usuarios` con axe-core (WCAG 2.1 AA).
2. Abrir los diálogos «Nuevo usuario» y los de las acciones de otro usuario activo, analizar cada uno y cerrarlo con Escape sin confirmar.

### Resultado esperado

Ninguna violación critical ni serious en la vista ni en los diálogos.

## TC-E-039

### Precondición

Ítem disponible en el seed. KDS abierto con el usuario Mozo. Sandbox de Mercado Pago con las tarjetas de prueba (titulares FUND y APRO).

### Pasos

1. Abrir el menú por el link web, agregar el ítem y «Continuar al pago».
2. Pagar con el titular FUND.
3. Recargar el KDS.
4. Pagar de nuevo con el titular APRO.

### Resultado esperado

2. El pago responde 402 y se ve «No se pudo completar el cobro», con el aviso de que no se realizó ningún cargo.
3. El pedido no está en el KDS.
4. El pago responde 201, se ve «¡Tu pedido ya está en cocina!», no se crea otro pedido y el mismo pedido aparece en el KDS sin recargarlo.
   Al final, el pedido se entrega desde el KDS.

## TC-E-040

### Precondición

Usuario de plataforma de E2E (`TEST_PLATAFORMA_*`, con OTP). El spec da de alta su propio establecimiento por la API, activo y sin pedidos.

### Pasos

1. En `/plataforma`, buscar por el RUT del establecimiento.
2. Buscar por su razón social, en minúsculas.
3. Con el RUT, filtrar por «Activos» y después por «Suspendidos».

### Resultado esperado

1. Aparece una sola fila, con su razón social.
2. Aparece la misma fila.
3. Con «Activos» aparece; con «Suspendidos», el listado muestra «Ningún establecimiento coincide con…».

## TC-E-041

### Precondición

El establecimiento de prueba de TC-E-040.

### Pasos

1. Desde el listado, abrir «Ver ficha» del establecimiento.

### Resultado esperado

La ficha muestra la razón social como título, el RUT, la sección «Administradores» con un Administrador, la sección «Resumen» y el botón «Eliminar definitivamente» (no tiene pedidos).

## TC-E-042

### Precondición

El establecimiento de prueba de TC-E-040.

### Pasos

1. En la ficha, «Editar datos».
2. Cambiar la razón social y «Guardar cambios».
3. Buscar el establecimiento en el listado.

### Resultado esperado

2. El diálogo se cierra, se anuncia «Datos guardados.» y el título de la ficha muestra la razón social nueva.
3. La fila del listado muestra la razón social nueva.

## TC-E-043

### Precondición

El establecimiento de prueba de TC-E-040, activo.

### Pasos

1. En la ficha, «Suspender», escribir un motivo y «Suspender establecimiento».
2. En el listado, filtrar por «Suspendidos» y buscar por el RUT.
3. En la ficha, «Reactivar» y confirmar.

### Resultado esperado

1. Se anuncia «Establecimiento suspendido.» y la ficha muestra el motivo.
2. Aparece con la etiqueta «Suspendido».
3. Se anuncia «Establecimiento reactivado.», ya no se muestra el motivo y vuelve a ofrecer «Suspender».

## TC-E-044

### Precondición

El establecimiento de prueba de TC-E-040.

### Pasos

En tres anchos (celular 390 px, tablet 768 px y PC 1280 px):

1. Analizar con axe-core el listado con el establecimiento buscado.
2. Analizar la ficha.
3. Abrir y analizar los diálogos «Editar datos», «Suspender» y «Eliminar definitivamente», y cerrarlos con «Cancelar» sin confirmar nada.

### Resultado esperado

Ninguna violación critical ni serious de WCAG 2.1 AA en ninguna pantalla ni diálogo, en los tres anchos.

## TC-E-045

### Precondición

El establecimiento de prueba de TC-E-040, sin pedidos.

### Pasos

1. En la ficha, «Eliminar definitivamente».
2. Escribir un RUT distinto en «Escribí el RUT para confirmar».
3. Escribir el RUT correcto y confirmar.
4. «Volver al listado» y buscar el RUT.

### Resultado esperado

1. El foco empieza en «Cancelar» y el botón de confirmar está deshabilitado.
2. El botón sigue deshabilitado.
3. El resultado dice que el establecimiento se eliminó.
4. Vuelve a `/plataforma` y el listado muestra «Ningún establecimiento coincide con…».
