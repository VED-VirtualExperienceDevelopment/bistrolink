# Tests de contrato (PactJS)

Pruebas de contrato entre el backend de BistroLink y las APIs de los
proveedores externos (RNF.04, EDT 1.6.2). Fijan **solo lo que nuestro código
envía o lee** de cada proveedor, para enterarnos en el CI si algo de eso
cambia, sin depender del sandbox del proveedor.

| Proveedor                | Archivo                            | Contrato (pact)                                  | Casos          | Ticket |
| ------------------------ | ---------------------------------- | ------------------------------------------------ | -------------- | ------ |
| Mercado Pago, API Orders | `mercadopago-orders.pact.spec.ts`  | `bistrolink-backend-mercadopago-orders-api.json` | TC-C-001 a 007 | BL-215 |
| Mercado Pago, webhook    | `mercadopago-webhook.pact.spec.ts` | `bistrolink-backend-mercadopago-webhooks.json`   | TC-C-008 y 009 | BL-215 |
| Surtec (CFE)             | (pendiente)                        | (pendiente)                                      | desde TC-C-010 | BL-216 |

## Cómo funcionan

- **Consumidor:** `bistrolink-backend`. **Proveedor:** uno por API
  (`mercadopago-orders-api`, `mercadopago-webhooks`).
- **HTTP** (BistroLink llama al proveedor): `addInteraction()` con el mock
  server de Pact. El test llama al gateway real (por ejemplo,
  `MercadoPagoGateway`) apuntado al mock.
- **Mensaje** (el proveedor nos llama, como un webhook):
  `addAsynchronousInteraction()`. El test pasa el mensaje por el mismo código
  que usa el controller.
- **Matchers, no valores fijos:** `like`, `regex`, `eachLike`. Los valores
  exactos solo donde nuestro código toma una decisión con ellos (por
  ejemplo, `status` y `status_detail`). Así un campo nuevo del proveedor no
  rompe el contrato, pero un cambio en algo que usamos sí.
- **Estados del proveedor** (`given`): describen la situación del lado del
  proveedor («la tarjeta de prueba del pagador tiene fondos»). Los ids que
  algún día tienen que ser reales usan `fromProviderState`.
- **Sin datos reales:** tokens, tarjetas y correos de ejemplo. Nunca
  credenciales ni URLs de entornos (el repositorio es público).

## Correrlos

```bash
npm run test:pact --workspace=backend
```

Borra `apps/backend/pacts/` y lo vuelve a generar. **El pact generado se
commitea**: el CI corre los tests y falla si el pact cambió y no está en el
commit («El contrato con Mercado Pago cambió y no está commiteado»). Si el
cambio es a propósito, revisá el diff de `apps/backend/pacts/` y commitealo
junto con el código.

Un solo contrato: `npm run test:pact --workspace=backend -- -t 'parte del título'`.

## Convenciones

### Títulos

Cada test empieza con su ID y el proveedor:

```
[TC-C-NNN] <Proveedor> <API>: <qué pide BistroLink> <qué responde el proveedor>
```

Por ejemplo: `[TC-C-002] Mercado Pago Orders: POST /v1/orders con rechazo del emisor responde 402 con el motivo en data.transactions`.

- `TC-C` es la numeración de los contratos, **una sola para todos los
  proveedores** y aparte de `TC-I` (integración), `TC-E` (E2E) y `TC-U`
  (unitarios). Se toma el siguiente número libre.
- El título es el título del caso en Kiwi, **idéntico**. Sin comillas ni
  los signos `<`, `>` y `&`: Kiwi los guarda escapados y el reporte no
  encontraría el caso. Se usan `«»` y palabras.
- Con `it.each`, el título completo va en la **primera columna** y el
  título del test es `'%s'`. Así cada fila tiene su propio `[TC-C-NNN]` y
  el script de carga lo lee del código:

  ```ts
  it.each([
    ['[TC-C-004] Mercado Pago Orders: GET /v1/orders/{id} de una order aprobada …', 'processed'],
    ['[TC-C-005] Mercado Pago Orders: GET /v1/orders/{id} de una order pendiente …', 'action_required'],
  ])('%s', async (_titulo, status) => { … });
  ```

### Kiwi TCMS

- Test Plan **«Contract-PactJS»** (producto Bistrolink, versión `develop`,
  tipo Integration). Un solo plan para todos los proveedores; el proveedor
  va como tag (`mercadopago`, `surtec`).
- Datos de cada caso: Category `Funcional`, Component `api`, Requirement
  con la HU que usa el endpoint (HU-007 cobro, HU-032 consulta y webhook),
  tags `contrato`, el proveedor y los tickets.
- El CI sube los resultados en cada push a `develop` (no en los PR), al
  Test Run `<versión>-contract` de ese plan. Busca cada caso por su título:
  **un caso que no esté cargado se crea solo con el título**.

### Agregar o cambiar un contrato

1. Escribir el test con su `[TC-C-NNN]` (o cambiar el título).
2. Sumar sus datos a `DATOS_CONTRATO` en
   `scripts/kiwi/cargar-casos-integracion.mjs` y su bloque `## TC-C-NNN` en
   `scripts/kiwi/descripciones-contrato.md`.
3. Correr `npm run test:pact --workspace=backend` y commitear el pact.
4. **Antes de mergear**, cargar el caso en Kiwi (PowerShell, desde la raíz,
   con `KIWI_TCMS_URL`, `KIWI_TCMS_USERNAME` y `KIWI_TCMS_PASSWORD` en la
   sesión):

   ```powershell
   node scripts/kiwi/cargar-casos-integracion.mjs --contrato --descripciones            # ver qué cambia
   node scripts/kiwi/cargar-casos-integracion.mjs --contrato --aplicar --descripciones  # cargar
   node scripts/kiwi/cargar-casos-integracion.mjs --contrato --descripciones            # verificar
   ```

   La verificación tiene que decir «0 faltan» y «0 para actualizar».

### Un proveedor nuevo (por ejemplo, Surtec en BL-216)

- Un archivo `<proveedor>-<api>.pact.spec.ts` en esta carpeta, con su
  `PactV4` (`consumer: 'bistrolink-backend'`, `provider: '<proveedor>-<api>'`,
  `dir: apps/backend/pacts`).
- Probar el cliente real del proveedor (por ejemplo, `surtec.client.ts`)
  contra el mock, como se hace con `MercadoPagoGateway`.
- Sus casos siguen la numeración `TC-C` y van al mismo plan, con el tag del
  proveedor.
- Sumar una fila a la tabla de arriba.
