# Seguridad: Endpoints Públicos

Este documento describe el modelo de seguridad de los endpoints públicos de BistroLink, específicamente los endpoints de acceso al menú sin autenticación.

## Endpoints Públicos

### HU-001: Acceso al menú por mesa (QR)
- **Ruta**: `GET /menu/:tenantId/:mesaId`
- **Propósito**: Permitir a comensales escanear un QR en la mesa para ver el menú
- **Criterio de aceptación**: "Funciona sin login ni instalación previa"

### HU-002: Acceso al menú por enlace directo
- **Ruta**: `GET /menu/tenant/:tenantId/restaurante/:restauranteId`
- **Propósito**: Permitir a comensales acceder al menú desde fuera del local vía enlace web
- **Criterio de aceptación**: "Funciona sin login ni instalación previa"

---

## Modelo de Amenazas (Threat Model)

### ¿Qué protegemos?
1. **Aislamiento multi-tenant**: Un tenant NO puede acceder a datos de otro tenant
2. **Integridad de datos**: Solo se pueden consultar recursos que existen
3. **Prevención de inyección**: Los parámetros de URL no pueden ser explotados

### ¿Qué NO protegemos en estos endpoints?
- **Autenticación**: Por diseño, estos endpoints son públicos (decisión de negocio)
- **Autorización**: Cualquier persona con la URL puede acceder (pero solo a datos del tenant correcto)

---

## Capas de Defensa (Defensa en Profundidad)

### Capa 1: Validación de Parámetros (ParseUUIDPipe)
**Ubicación**: `menu.controller.ts`

```typescript
@Param('tenantId', ParseUUIDPipe) tenantId: string
@Param('restauranteId', ParseUUIDPipe) restauranteId: string