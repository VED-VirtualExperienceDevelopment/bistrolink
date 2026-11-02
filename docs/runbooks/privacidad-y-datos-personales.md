# Privacidad y datos personales (Ley 18.331)

> HU-036 (BL-206). Obligaciones del establecimiento y procedimientos del
> equipo de BistroLink sobre los datos personales que trata el sistema.

## Control de versiones

| Versión | Fecha      | Modificación                                                                                      |
| ------- | ---------- | ------------------------------------------------------------------------------------------------- |
| 1.0     | 01/11/2026 | Primera versión: roles, datos que trata el sistema, registro ante la URCDP y pedidos de derechos. |

## 1. Roles

- **Responsable de la base de datos:** cada establecimiento (tenant). Sus
  datos (nombre del local, razón social, RUT y dirección) se muestran en su
  política de privacidad, en `/privacidad`.
- **Encargado del tratamiento:** BistroLink, que trata los datos por cuenta
  del establecimiento.
- **Organismo de control:** Unidad Reguladora y de Control de Datos
  Personales (URCDP).

## 2. Qué datos personales trata el sistema hoy

| Dato                                              | Dónde                                       | Para qué                                             | Conservación                                |
| ------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| Pedido: ítems, notas, mesa y hora                 | `pedido`, `linea_pedido`                    | Preparar y cobrar el pedido                          | Registro de la operación                    |
| Correo y documento del pagador                    | Solo en tránsito hacia Mercado Pago         | Procesar el pago con tarjeta y enviar el comprobante | **No se guardan**                           |
| Datos de la tarjeta                               | Campos seguros de Mercado Pago              | Pago                                                 | **Nunca pasan por BistroLink**              |
| Pedido en curso                                   | `sessionStorage` de la pestaña del comensal | Retomar el pago al recargar (BL-448)                 | Hasta cerrar la pestaña o hacer otro pedido |
| Colaboradores: usuario, nombre, apellido y correo | `usuario` y Keycloak                        | Acceso al panel                                      | Mientras la cuenta exista                   |
| Correo de privacidad del local                    | `restaurante.email_privacidad`              | Canal para los derechos                              | Mientras el local lo tenga cargado          |

El e-Ticket se emite a consumidor final, sin datos personales. **Pendiente:**
la e-Factura (HU-009, BL-92) va a guardar el RUT y la razón social del
comensal que la pide, y el pedido para retirar (HU-040) va a guardar su
nombre y su contacto. Cada historia agrega el aviso de consentimiento, la
anonimización y la actualización de la política (ver su DoD).

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
   tiene nombre ni correo del comensal: hoy no hay datos personales que
   devolver, salvo lo que haya escrito en las notas.
3. Si pide suprimir notas con datos personales, el local lo pide al equipo de
   BistroLink, que las reemplaza en la base por un texto neutro. Los CFE
   emitidos y los montos no se tocan: se conservan 5 años por la obligación
   fiscal.
4. Plazo legal de respuesta: 5 días hábiles para el acceso (Ley 18.331,
   art. 14) y 5 días hábiles para rectificar o suprimir (art. 15).

## 5. Controles técnicos

- **Logs:** Pino reemplaza por `[REDACTED]` los campos con datos personales
  (`email`, `payerEmail`, `password`, `rut`, `razonSocial`, `telefono`,
  `identificationNumber`, `documento`, `emailPrivacidad`) en la raíz del
  objeto y un nivel abajo (`apps/backend/src/logs-datos-personales.ts`), además de
  las credenciales de los headers. Lo prueba
  `test/unitarios/logs-datos-personales.spec.ts`.
- **Auditoría:** los cambios de la razón social y del correo de privacidad
  se auditan sin el valor.
- **Aislamiento:** RLS por tenant en todas las tablas con datos del local.

## 6. Verificación en staging

- La política se abre desde la carta (web y QR) y desde el formulario de
  pago (TC-E-062).
- Buscar en los logs de `bistrolink-api` de staging correos, RUT o teléfonos
  en texto plano después de hacer un pedido y un pago (no tiene que haber).
