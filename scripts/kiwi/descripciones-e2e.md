# Descripciones de los casos E2E (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                         |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 27/10/2026 | Plantilla (BL-435).                                                                                                                                  |
| 1.1     | 28/10/2026 | TC-E-046 a 049: cobro en efectivo (BL-201), solicitud de efectivo (BL-442) y pedido del mozo (BL-209).                                               |
| 1.2     | 31/10/2026 | TC-E-007 y 008 cambian: la carta por URL muestra los agotados bloqueados, igual que el QR (BL-397).                                                  |
| 1.3     | 31/10/2026 | TC-E-050 a 055: Gestión de Carta (BL-392 / BL-402).                                                                                                  |
| 1.4     | 01/11/2026 | TC-E-056 a 058: medios de pago del comensal según la configuración del local (BL-452).                                                               |
| 1.5     | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-059 a 061: retomar el pago al recargar y aviso de efectivo en el KDS (BL-448).          |
| 1.6     | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-062: política de privacidad desde la carta y el pago (BL-206).                          |
| 1.7     | 02/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-063 y 064: e-Factura con RUT y razón social desde la pantalla de pago (HU-009, BL-453). |

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

## TC-E-063

### Precondición

Mesa del seed abierta con su QR y efectivo habilitado en el establecimiento.

### Pasos

1. Desde el QR de la mesa, agregar un ítem, ir a pagar y elegir «Efectivo».
2. Marcar «Quiero e-Factura con RUT» y completar un RUT válido y la razón social.
3. No marcar «Acepto que el local guarde mi RUT y mi razón social…».
4. Tocar «Avisar al mozo».

### Resultado esperado

1. El aviso tiene el enlace a la política de privacidad y, sin aceptarlo, dice «Sin aceptar, no guardamos estos datos y te damos un e-Ticket.».
2. La solicitud de efectivo sale con `receptorFiscal: null`, sin el RUT ni la razón social.
3. La pantalla pasa a «Esperando al mozo». Al terminar, el mozo cobra el pedido y se entrega desde el KDS.

## TC-E-064

### Precondición

Mesa del seed abierta con su QR y efectivo habilitado en el establecimiento.

### Pasos

1. Desde el QR de la mesa, agregar un ítem, ir a pagar y elegir «Efectivo».
2. Marcar «Quiero e-Factura con RUT», completar un RUT con el dígito verificador incorrecto y la razón social, y aceptar el aviso.
3. Tocar «Avisar al mozo».

### Resultado esperado

El campo RUT queda marcado con error («el último dígito (verificador) no corresponde») y con el foco. No se envía la solicitud de efectivo.
