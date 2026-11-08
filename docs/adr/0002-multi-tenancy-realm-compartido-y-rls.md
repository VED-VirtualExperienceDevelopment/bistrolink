# ADR 0002 — Multi-tenancy con un realm compartido de Keycloak y Row Level Security

| Campo | Valor |
| --- | --- |
| Estado | Aceptada |
| Fecha | 02/08/2026 (migración `enable_rls`); ajustes del 07/10 al 09/10/2026 |
| Referencias | RD.07; EDT 1.2.7; riesgo R-14; BL-133, BL-262, BL-267, BL-275 |
| Autores | E. Arenas, V. Couto, D. Silvera |

## Contexto

Cada establecimiento (tenant) tiene que ver solo sus propios datos: carta, mesas, pedidos, pagos, comprobantes y usuarios. Una fuga de datos entre establecimientos es el riesgo de seguridad más grave del proyecto (R-14). El Anteproyecto y RF.19 hablaban de un realm de Keycloak por establecimiento.

## Decisión

El aislamiento se aplica en dos capas, con una sola fuente para el tenant:

1. **Identidad: un único realm de Keycloak.** Cada cuenta tiene el atributo `tenant_id`, y un client scope lo agrega como claim al JWT. El atributo solo lo puede ver y editar un administrador del realm, no el propio usuario. El rol de plataforma (alta de establecimientos) no tiene `tenant_id` y exige OTP.
2. **Datos: Row Level Security en PostgreSQL.** Las tablas de negocio tienen RLS activado y forzado (`FORCE ROW LEVEL SECURITY`), con políticas que comparan `tenant_id` con la variable de sesión `app.tenant_id`.
3. **El backend fija el tenant por transacción.** `TenantPrismaService.runInTenantContext(tenantId, …)` abre una transacción y ejecuta `set_config('app.tenant_id', …, true)`, que vale solo dentro de esa transacción. Toda la lógica de negocio pasa por ahí. El `tenantId` sale del JWT, nunca del cuerpo de la request.
4. **La API usa un rol de base restringido**, sin superusuario y sin `BYPASSRLS`. Las migraciones usan otro rol, con permisos de dueño. Así, un error en el código no puede saltear RLS.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Un realm de Keycloak por establecimiento | Hay que crear y mantener un realm, sus clientes y su configuración por cada alta; el backend tiene que validar tokens de N emisores. No aporta aislamiento de datos, que igual depende de la base. |
| Una base o un esquema por establecimiento | Multiplica migraciones, respaldos y conexiones. Es desproporcionado para el volumen del MVP. |
| Filtrar por `tenant_id` solo en el código | Un `WHERE` olvidado expone datos de otro establecimiento sin que nada lo frene. |

## Consecuencias

- El aislamiento no depende solo de que cada consulta tenga el filtro correcto: si falta, la base no devuelve filas de otro tenant.
- Toda consulta de negocio tiene que correr dentro de `runInTenantContext`. Las migraciones que tocan tablas multi-tenant requieren la revisión de un segundo integrante (Anexo 6 §9).
- La conexión con el rol equivocado desactiva RLS sin ningún error visible. Pasó dos veces (BL-133 y BL-275): por eso hay tests de aislamiento entre tenants en la suite de integración (TC-I-001 a 005, 031, 033 y 043-044) y el rol restringido está en el checklist de producción.
- La cuenta de servicio del backend en Keycloak ve todo el realm; la gestión de usuarios valida el tenant contra la base, bajo RLS, antes de operar en Keycloak.
- RF.19, RD.07 y el Anexo 4 §1.7.1 se corrigieron para describir el realm compartido (solicitud de cambio del 30/10/2026, BL-267).
