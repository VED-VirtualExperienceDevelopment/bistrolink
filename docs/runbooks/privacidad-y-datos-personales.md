# Privacidad y datos personales (Ley 18.331)

> HU-036 (BL-206). Obligaciones del establecimiento y procedimientos del
> equipo de BistroLink sobre los datos personales que trata el sistema.

## Control de versiones

| Versión | Fecha      | Modificación                                                                                      |
| ------- | ---------- | ------------------------------------------------------------------------------------------------- |
| 1.0     | 01/11/2026 | Primera versión: roles, datos que trata el sistema, registro ante la URCDP y pedidos de derechos. |
| 1.1     | 02/11/2026 | HU-009 (BL-453): RUT y razón social de la e-Factura, consentimiento y anonimización.              |

## 1. Roles

- **Responsable de la base de datos:** cada establecimiento (tenant). Sus
  datos (nombre del local, razón social, RUT y dirección) se muestran en su
  política de privacidad, en `/privacidad`.
- **Encargado del tratamiento:** BistroLink, que trata los datos por cuenta
  del establecimiento.
- **Organismo de control:** Unidad Reguladora y de Control de Datos
  Personales (URCDP).

## 2. Qué datos personales trata el sistema hoy

| Dato                                              | Dónde                                                       | Para qué                                             | Conservación                                |
| ------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| Pedido: ítems, notas, mesa y hora                 | `pedido`, `linea_pedido`                                    | Preparar y cobrar el pedido                          | Registro de la operación                    |
| Correo y documento del pagador                    | Solo en tránsito hacia Mercado Pago                         | Procesar el pago con tarjeta y enviar el comprobante | **No se guardan**                           |
| Datos de la tarjeta                               | Campos seguros de Mercado Pago                              | Pago                                                 | **Nunca pasan por BistroLink**              |
| Pedido en curso                                   | `sessionStorage` de la pestaña del comensal                 | Retomar el pago al recargar (BL-448)                 | Hasta cerrar la pestaña o hacer otro pedido |
| Colaboradores: usuario, nombre, apellido y correo | `usuario` y Keycloak                                        | Acceso al panel                                      | Mientras la cuenta exista                   |
| Correo de privacidad del local                    | `restaurante.email_privacidad`                              | Canal para los derechos                              | Mientras el local lo tenga cargado          |
| RUT y razón social de la e-Factura (HU-009)       | `pedido.receptor_rut`, `receptor_razon_social` y Surtec/DGI | Emitir la e-Factura a nombre del comensal            | Hasta que se anonimizan; el CFE, 5 años     |

El e-Ticket se emite a consumidor final, sin datos personales.

**e-Factura (HU-009, BL-453):** el comensal la pide en la pantalla de pago,
antes de pagar. El RUT y la razón social solo se guardan si acepta el aviso
(con enlace a `/privacidad`); queda la fecha en `pedido.receptor_consentido_en`.
Sin aceptarlo, no se guardan y se emite un e-Ticket. Los datos viajan a
Surtec para emitir el CFE (tipo 111) y quedan en el CFE ante DGI.

**Pendiente:** el pedido para retirar (HU-040) va a guardar el nombre y el
contacto del comensal; esa historia agrega su aviso, la anonimización y la
actualización de la política.

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
2. El local identifica los pedidos por fecha, mesa y monto. BistroLink no
   tiene nombre ni correo del comensal: no hay más datos personales que
   devolver que lo que haya escrito en las notas y, si pidió e-Factura, su
   RUT y su razón social.
   - **Supresión de los datos de la e-Factura:** el Administrador entra a
     **Configuración → Anonimizar datos de facturación**, ingresa el RUT del
     comensal y confirma. En todos los pedidos del local con ese RUT se
     borran el RUT y la razón social, y queda la fecha en
     `pedido.receptor_anonimizado_en`. No se puede deshacer. Queda en la
     auditoría como `PEDIDO_RECEPTOR_ANONIMIZADO`, con la cantidad de
     pedidos y sin el RUT. La e-Factura ya emitida no cambia (está
     informada a DGI y se conserva 5 años).
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
  `receptorRut`, `receptorRazonSocial`, `nro_doc` y `denominacion`) en la raíz del
  objeto y un nivel abajo (`apps/backend/src/logs-datos-personales.ts`), además de
  las credenciales de los headers. Lo prueba
  `test/unitarios/logs-datos-personales.spec.ts`.
- **Auditoría:** los cambios de la razón social y del correo de privacidad
  se auditan sin el valor. La anonimización de la e-Factura, sin el RUT.
- **Errores de Surtec:** si Surtec rechaza una e-Factura y repite el
  `cliente` en su respuesta, el mensaje del error lo oculta antes de llegar
  al log (`cuerpoParaLog` en `surtec.client.ts`).
- **Aislamiento:** RLS por tenant en todas las tablas con datos del local.

## 6. Verificación en staging

- La política se abre desde la carta (web y QR) y desde el formulario de
  pago (TC-E-062), también desde el aviso de la e-Factura.
- e-Factura sin aceptar el aviso: el pedido queda sin RUT ni razón social
  (TC-E-063) y se emite un e-Ticket.
- Buscar en los logs de `bistrolink-api` de staging correos, RUT o teléfonos
  en texto plano después de hacer un pedido y un pago (no tiene que haber).
