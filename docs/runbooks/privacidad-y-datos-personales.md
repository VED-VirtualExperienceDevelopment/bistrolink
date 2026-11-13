# Privacidad y datos personales (Ley 18.331)

> HU-036 (BL-206). Obligaciones del establecimiento y procedimientos del
> equipo de BistroLink sobre los datos personales que trata el sistema.

## Control de versiones

| Versión | Fecha      | Modificación                                                                                               |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| 1.0     | 01/11/2026 | Primera versión: roles, datos que trata el sistema, registro ante la URCDP y pedidos de derechos.          |
| 1.1     | 02/11/2026 | HU-009 (BL-453): RUT y razón social de la e-Factura, consentimiento y anonimización.                       |
| 1.2     | 02/11/2026 | BL-453: sin aceptar el aviso, la pantalla no deja pagar con datos de la e-Factura cargados.                |
| 1.3     | 07/11/2026 | BL-454: copia del PDF del comprobante en S3 y descarga desde la API.                                       |
| 1.4     | 10/11/2026 | BL-502: «Mis pedidos» en la mesa guarda en el teléfono los ids de los pedidos hasta que se cierra la mesa. |
| 1.5     | 12/11/2026 | HU-040 (BL-210): nombre y contacto del pedido para retirar, consentimiento y anonimización.                |

## 1. Roles

- **Responsable de la base de datos:** cada establecimiento (tenant). Sus
  datos (nombre del local, razón social, RUT y dirección) se muestran en su
  política de privacidad, en `/privacidad`.
- **Encargado del tratamiento:** BistroLink, que trata los datos por cuenta
  del establecimiento.
- **Organismo de control:** Unidad Reguladora y de Control de Datos
  Personales (URCDP).

## 2. Qué datos personales trata el sistema hoy

| Dato                                               | Dónde                                                                           | Para qué                                                     | Conservación                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| Pedido: ítems, notas, mesa y hora                  | `pedido`, `linea_pedido`                                                        | Preparar y cobrar el pedido                                  | Registro de la operación                               |
| Correo y documento del pagador                     | Solo en tránsito hacia Mercado Pago                                             | Procesar el pago con tarjeta y enviar el comprobante         | **No se guardan**                                      |
| Datos de la tarjeta                                | Campos seguros de Mercado Pago                                                  | Pago                                                         | **Nunca pasan por BistroLink**                         |
| Pedido en curso                                    | `sessionStorage` de la pestaña (pedido para retirar)                            | Retomar el pago al recargar (BL-448)                         | Hasta cerrar la pestaña o hacer otro pedido            |
| Mis pedidos en la mesa (BL-502)                    | `localStorage` del teléfono del comensal: ids de sus pedidos y el pago en curso | Ver sus pedidos y retomar el pago al volver a escanear el QR | Hasta que se cierra la mesa (la clave lleva la sesión) |
| Colaboradores: usuario, nombre, apellido y correo  | `usuario` y Keycloak                                                            | Acceso al panel                                              | Mientras la cuenta exista                              |
| Correo de privacidad del local                     | `restaurante.email_privacidad`                                                  | Canal para los derechos                                      | Mientras el local lo tenga cargado                     |
| RUT y razón social de la e-Factura (HU-009)        | `pedido.receptor_rut`, `receptor_razon_social` y Surtec/DGI                     | Emitir la e-Factura a nombre del comensal                    | Hasta que se anonimizan; el CFE, 5 años                |
| Nombre y contacto del pedido para retirar (HU-040) | `pedido.retiro_nombre`, `retiro_contacto`                                       | Reconocer al comensal en el mostrador                        | Hasta que se anonimizan                                |

El e-Ticket se emite a consumidor final, sin datos personales.

**e-Factura (HU-009, BL-453):** el comensal la pide en la pantalla de pago,
antes de pagar. El RUT y la razón social solo se guardan si acepta el aviso
(con enlace a `/privacidad`); queda la fecha en `pedido.receptor_consentido_en`.
Si cargó el RUT o la razón social y no aceptó el aviso, la pantalla no deja
pagar hasta que lo acepte, borre los datos o desmarque la e-Factura (en ese
caso recibe un e-Ticket). El backend, igual, sin consentimiento no guarda
nada y emite un e-Ticket. Los datos viajan a
Surtec para emitir el CFE (tipo 111) y quedan en el CFE ante DGI.

**PDF del comprobante (BL-454):** el de una e-Factura lleva el RUT y la
razón social del receptor. Se guarda una copia en el bucket privado de los
CFE (`S3_BUCKET_CFE`, HU-029) porque la DGI exige conservar los comprobantes
5 años (Res. DGI 798/2012); Surtec también los conserva ese plazo. Solo el
backend accede al bucket, la clave del objeto empieza con el `tenant_id` y no
tiene datos del receptor, y el PDF no va a los logs. El comensal (desde la
pantalla de pago) y el administrador (desde Comprobantes) lo descargan a
través de la API, con los mismos controles de acceso que el comprobante. La
anonimización de los datos de facturación del pedido (BL-453) no alcanza a
esta copia: es un comprobante fiscal que hay que conservar.

**Pedido para retirar (HU-040, BL-210):** en el enlace web del local, el
comensal puede dejar su nombre y un teléfono o correo. Es opcional y solo se
guarda si acepta el aviso (con enlace a `/privacidad`); queda la fecha en
`pedido.retiro_consentido_en`. Sin consentimiento el backend no guarda nada y
el pedido sigue igual: se entrega con el código de retiro (`R-042`), que no es
un dato personal. El contacto se guarda normalizado (correo en minúsculas;
teléfono solo con los dígitos) para poder encontrarlo al anonimizar. No se
envía a terceros (ni a Surtec ni a Mercado Pago). El aviso de «pedido listo»
es una notificación del navegador con el permiso del comensal: no usa su
contacto.

## 3. Registro de la base de datos ante la URCDP

Es una **obligación del establecimiento**, como responsable. Antes de operar
con datos de comensales:

1. Inscribir la base de datos en el registro de la URCDP (trámite en línea
   en gub.uy).
2. Indicar como finalidad la gestión de pedidos y pagos del local, y como
   encargado del tratamiento a BistroLink.
3. Cargar en **Configuración → Privacidad** el correo donde va a recibir los
   pedidos de los comensales.

Conviene recordárselo al local en su puesta en marcha (aprovisionamiento,
HU-027).

## 4. Pedidos de acceso, rectificación y supresión

1. El comensal escribe al correo de privacidad del local (o lo pide en el
   local).
2. El local identifica los pedidos por fecha, mesa y monto. No hay más
   datos personales que devolver que lo que el comensal haya escrito en las
   notas; si pidió e-Factura, su RUT y su razón social, y si dejó sus datos en
   un pedido para retirar, su nombre y su contacto.
   - **Supresión de los datos de la e-Factura:** el Administrador entra a
     **Configuración → Anonimizar datos de facturación**, ingresa el RUT del
     comensal y confirma. En todos los pedidos del local con ese RUT se
     borran el RUT y la razón social, y queda la fecha en
     `pedido.receptor_anonimizado_en`. No se puede deshacer. Queda en la
     auditoría como `PEDIDO_RECEPTOR_ANONIMIZADO`, con la cantidad de
     pedidos y sin el RUT. La e-Factura ya emitida no cambia (está
     informada a DGI y se conserva 5 años).
   - **Supresión del nombre y el contacto de un pedido para retirar:** el
     Administrador entra a **Configuración → Anonimizar datos de pedidos
     para retirar**, ingresa el teléfono o el correo que dejó el comensal y
     confirma (se normaliza igual que al guardarlo). En todos los pedidos del
     local con ese contacto se borran el nombre y el contacto, y queda la
     fecha en `pedido.retiro_anonimizado_en`. No se puede deshacer. Queda en
     la auditoría como `PEDIDO_RETIRO_ANONIMIZADO`, con la cantidad de
     pedidos y sin el contacto. El pedido, los montos y el comprobante no
     cambian.
3. Si pide suprimir notas con datos personales, el local lo pide al equipo de
   BistroLink, que las reemplaza en la base por un texto neutro. Los CFE
   emitidos y los montos no se tocan: se conservan 5 años por la obligación
   fiscal.
4. Plazo legal de respuesta: 5 días hábiles para el acceso (Ley 18.331,
   art. 14) y 5 días hábiles para rectificar o suprimir (art. 15).

## 5. Controles técnicos

- **Logs:** Pino reemplaza por `[REDACTED]` los campos con datos personales
  (`email`, `payerEmail`, `password`, `rut`, `razonSocial`, `telefono`,
  `identificationNumber`, `documento`, `emailPrivacidad` y, desde HU-009,
  `receptorRut`, `receptorRazonSocial`, `nro_doc` y `denominacion`; desde HU-040,
  `retiroNombre`, `retiroContacto` y `contactoRetiro`) en la raíz del
  objeto y un nivel abajo (`apps/backend/src/logs-datos-personales.ts`), además de
  las credenciales de los headers. Lo prueba
  `test/unitarios/logs-datos-personales.spec.ts`.
- **Auditoría:** los cambios de la razón social y del correo de privacidad
  se auditan sin el valor. La anonimización de la e-Factura, sin el RUT, y la
  del pedido para retirar, sin el contacto.
- **Errores de Surtec:** si Surtec rechaza una e-Factura y repite el
  `cliente` en su respuesta, el mensaje del error lo oculta antes de llegar
  al log (`cuerpoParaLog` en `surtec.client.ts`).
- **Aislamiento:** RLS por tenant en todas las tablas con datos del local.

## 6. Verificación en staging

- La política se abre desde la carta (web y QR) y desde el formulario de
  pago (TC-E-062), también desde el aviso de la e-Factura.
- e-Factura con datos cargados y sin aceptar el aviso: la pantalla no deja
  pagar; al desmarcarla, el pedido queda sin RUT ni razón social y se emite
  un e-Ticket (TC-E-063).
- Buscar en los logs de `bistrolink-api` de staging correos, RUT o teléfonos
  en texto plano después de hacer un pedido y un pago (no tiene que haber).
