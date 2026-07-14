# 03 — Autenticación, Roles y Scoping

> **Última verificación contra código:** 2026-07-13
> **Estado del proyecto:** base en `main`; ampliaciones del 13 jul en rama, no desplegadas
> **Archivos clave:** `src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts`, `src/lib/roles.ts`, `src/lib/data.ts`

Este documento describe la arquitectura de seguridad, la gestión de sesiones y la aplicación del control de acceso (scoping) en el sistema Transavic.

---

## 1. Mecanismo de Autenticación

El sistema utiliza **NextAuth v5 (beta)** con un proveedor de tipo **Credentials** (nombre de usuario y contraseña) y firma de sesiones mediante tokens web JSON (**JWT**). Las contraseñas están encriptadas con **bcrypt** (salt 10).

- **Middleware:** `src/middleware.ts` protege las rutas bajo `/dashboard/*` redirigiendo al login si no hay sesión activa.
- **Configuración central:** `src/auth.config.ts` maneja los callbacks de redirección y validación de rutas.
- **Flujo de login:** Al iniciar sesión exitosamente, se guarda el `id` y el `role` del usuario en el token JWT (`src/auth.ts:25-39`), lo que los hace accesibles en cualquier parte del servidor mediante `await auth()`.

---

## 2. Los Roles del Sistema (4 activos + 1 preparado)

El login redirige automáticamente al usuario según su rol a su pantalla de inicio definida en `src/lib/roles.ts:homeForRole()`:

| Rol | Pantalla de Inicio | Propósito y Permisos |
|---|---|---|
| **`admin`** | `/dashboard` | Acceso total sin scoping. Puede gestionar usuarios, productos, despacho, configurar settings y visualizar todas las facturas y comprobantes. |
| **`asesor`** | `/dashboard` | Preventa y cobranza. Puede crear pedidos y clientes, emitir comprobantes/Notas de Crédito y ver reportes de metas. Sus datos están estrictamente restringidos a los de su autoría (scoping). **Despacho:** Puede visualizar la pantalla `/dashboard/despacho` en modo **solo lectura con alcance total** (ve a todos los motorizados). |
| **`repartidor`** | `/dashboard/mi-ruta` | Reparto físico. Solo tiene acceso a la pantalla `/dashboard/mi-ruta` para gestionar sus entregas asignadas para el día de hoy. |
| **`produccion`** | `/dashboard/produccion` | Preparación y pesaje. Solo tiene acceso a la pantalla de `/dashboard/produccion` para visualizar la cola de pedidos de producción y registrar los pesos reales antes de despacho. Con la expansión ERP 2026 también gestiona **compras, mermas y el POS de planta**. |
| **`facturacion`** | `/dashboard/facturacion` | **Preparado, NO utilizable:** el rol está declarado en `roles.ts`, pero la API de usuarios no permite crearlo y la ruta/pantalla todavía no existe. Una fila legacy con este rol recibiría 404 al iniciar. Antes de activarlo hay que implementar la página, guards/API/scoping/sidebar y recién ampliar el zod de usuarios. |

---

## 2.1 Permisos Granulares (`PERMISSIONS` + `hasPermission()`)

Además del rol "grueso", `src/lib/roles.ts` define un **RBAC ligero** con permisos granulares. La función `hasPermission(role, permission)` verifica si el rol de la sesión está incluido en la lista del permiso:

```typescript
// src/lib/roles.ts
export const PERMISSIONS = {
  CAN_MANAGE_USERS:     ["admin"],
  CAN_MANAGE_PRODUCTS:  ["admin"],
  CAN_MANAGE_PRICES:    ["admin"],
  CAN_VIEW_ALL_ORDERS:  ["admin", "facturacion"],
  CAN_VIEW_OWN_ORDERS:  ["asesor"],
  CAN_MANAGE_PURCHASES: ["admin", "produccion"],   // Compras y mermas
  CAN_MANAGE_CASH:      ["admin", "facturacion"],  // Caja y gastos
  CAN_MANAGE_BILLING:   ["admin", "facturacion"],
  CAN_VIEW_REPORTS:     ["admin", "facturacion"],
  CAN_DELIVER:          ["repartidor"],
  CAN_WEIGH:            ["produccion", "admin"],
} as const;

export function hasPermission(role, permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}
```

Al agregar una pantalla o endpoint nuevo, **preferir `hasPermission()`** en lugar de comparar strings de rol a mano — así el permiso queda declarado en un solo lugar.

### Visibilidad de los módulos nuevos (expansión ERP 2026)

| Módulo | Roles que lo ven |
|---|---|
| Compras, proveedores, mermas, POS de planta, caja diaria | `admin` + `produccion` |
| CRM de leads (kanban + chat WhatsApp) | `admin` + `asesor` |
| Consolidado gerencial, rentabilidad, cuentas bancarias/transacciones | `admin` |
| Ventas, clientes, comprobantes y estado de cuenta de Campo | `admin` |
| Clientes/cobranzas de Planta | `admin` + `produccion` |
| Ventas Generales | `admin` |

### Visibilidad de ventas y facturación por operación

| Ruta | Roles | Scoping adicional |
|---|---|---|
| `/dashboard/comprobantes/ejecutivas` | `admin`, `asesor` | la asesora solo recibe sus comprobantes desde la API |
| `/dashboard/clientes-avicola/ventas` | `admin` | Campo pertenece a la operación de Antonio |
| `/dashboard/clientes-avicola/comprobantes` | `admin` | filtro fijo `operacion=campo` |
| `/dashboard/pos-planta` | `admin`, `produccion` | venta de Planta; no atribuir a asesora |
| `/dashboard/clientes-planta` / `cobranzas-planta` | `admin`, `produccion` | cartera propia de Planta |
| `/dashboard/comprobantes` | `admin`, `asesor` | hub general; asesor sigue scopeado aunque cambie filtros |
| `/dashboard/ventas-generales` | `admin` | lectura transversal de las tres operaciones |

Las páginas aplican guard server-side y las APIs repiten auth/rol/scoping. El filtrado de
`DashboardLayout.tsx` es solo navegación, nunca la barrera de seguridad.

---

## 3. Scoping de Datos en SQL (Capa de Aplicación)

Dado que la base de datos Postgres de Neon no tiene activadas políticas RLS (Row Level Security), **todo el control de acceso y restricción de datos se implementa en la capa de código (SQL de las APIs y helpers de datos)**.

### 3.1 Scoping de Pedidos (`lib/data.ts:fetchFilteredPedidos`)
Cuando un usuario consulta el dashboard de pedidos, la query SQL se ajusta dinámicamente según su rol:

```typescript
// src/lib/data.ts
const session = await auth();
if (!session?.user) return [];

const whereClauses = [];
const params = [];

if (session.user.role === "asesor") {
  // Las asesoras solo ven sus propios pedidos
  whereClauses.push(`p.asesor_id = $${params.length + 1}`);
  params.push(session.user.id);
} else if (session.user.role === "repartidor") {
  // Los repartidores solo ven sus pedidos asignados
  whereClauses.push(`p.repartidor_id = $${params.length + 1}`);
  params.push(session.user.id);
}
// El admin y el rol produccion no aplican scoping (ven todos)
```

### 3.2 Scoping de Clientes
- **Visualización:** Las asesoras solo pueden ver los clientes asociados a su `asesor_id` en `/dashboard/clientes`.
- **Modificación:** El endpoint `PATCH /api/clientes/[id]` verifica que el cliente pertenezca a la asesora de la sesión antes de realizar el UPDATE. El admin está exento de esta restricción y puede transferir clientes entre asesoras.
- **Anti-duplicados global:** El endpoint `GET /api/clientes/verificar` es global a propósito para detectar RUC/DNI ya registrados en carteras de otras asesoras, pero no expone datos sensibles del cliente ajeno (solo indica que existe y quién es la asesora responsable).

### 3.3 Creación Segura de Pedidos
Para evitar que una asesora registre ventas a nombre de otra (auditoría/comisión), el backend de creación de pedidos (`POST /api/pedidos`) implementa la siguiente lógica:

```typescript
// src/app/api/pedidos/route.ts
const finalAsesorId =
  session.user.role === "asesor" ? session.user.id : asesorId;
```
Esto anula el valor `asesorId` enviado en el body si el usuario logueado es una asesora, forzando su propia sesión.

## Adenda 13 jul 2026 — permisos de los nuevos flujos

| Capacidad | admin | asesor | produccion | repartidor |
|---|---:|---:|---:|---:|
| Ver ficha financiera/PDF de proveedor | Sí | No | No | No |
| Registrar o anular pago de proveedor | Sí | No | No | No |
| Ver detalle y costo histórico POS | Sí | No | Sí | No |
| Reprogramar cualquier fecha / “más tarde” | Sí | Solo pedido propio | No | No |
| Reprogramar para mañana desde Producción | Sí | No | Sí, estados productivos | No |
| Recibir popup `pedido_reprogramado` | Sí, fallback | Sí, pedido propio | No | No |

Producción puede seguir viendo el directorio de proveedores y registrar compras, pero
los saldos, pagos, anticipos y estados de cuenta permanecen bajo rol `admin`.
