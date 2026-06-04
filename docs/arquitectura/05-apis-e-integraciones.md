# 05 — APIs e Integraciones Externas

> **Última verificación contra código:** 2026-06-02 · **actualizado 2026-06-04** (endpoint de ubicación del repartidor + Capacitor ya en producción)
> **Archivos clave:** todos los `src/app/api/**/route.ts`, `src/lib/data.ts`, `src/lib/offline-queue.ts`, `src/lib/sunat/*`, `src/lib/{apisperu,brevo,email,gemini,insights,notificaciones,cobranzas,metas,incentivos,comprobante-scope}.ts`

> **Nota de alcance (jun 2026):** este doc creció mucho desde mayo. El sistema pasó de ~23 endpoints (solo pedidos/despacho/clientes/productos/users) a **~70 route handlers** repartidos en: comprobantes SUNAT, cobranzas/facturas, incentivos/metas, reportes, producción, notificaciones, búsqueda global, paneles agregados (mi-día, perfil 360°) y **4 cron jobs**. Todo lo de abajo está verificado contra el código de `main`. **El GPS en vivo del repartidor YA está en `main`** (4 jun 2026): tabla `rider_locations` + `POST /api/repartidor/ubicacion` (rol repartidor, scoping por sesión, UPSERT idempotente) + `GET /api/despacho` que adjunta la última ubicación de cada moto. El tracking se resolvió con **polling** (no Pusher).

---

## 1. Convenciones comunes en route handlers

### 1.1 Estructura típica de un handler

Patrón observado en ~90% de las APIs:

```typescript
// src/app/api/<feature>/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";   // Si lee sesión o DB en tiempo real

const RequestSchema = z.object({ /* ... */ });

export async function POST(request: Request) {
  try {
    // 1. Auth check
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // 2. (Opcional) Role check
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    // 3. Validar input con zod
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // 4. Instanciar cliente Neon
    const sql = neon(process.env.DATABASE_URL!);

    // 5. Ejecutar query
    const result = await sql`...`;

    // 6. Retornar
    return NextResponse.json({ data: result, message: "OK" }, { status: 200 });
  } catch (error) {
    console.error("Error en X:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
```

### 1.2 Status codes utilizados

| Código | Cuándo |
|---|---|
| **200** | OK genérico, query exitosa |
| **201** | Recurso creado (POST exitoso) |
| **204** | OK sin contenido (DELETE) |
| **400** | Input inválido (zod safeParse falló) |
| **401** | No autenticado |
| **403** | Autenticado pero sin permisos (rol incorrecto o ownership ajeno) |
| **404** | Recurso no encontrado (también: asesora pidiendo recurso ajeno — se usa 404, no 403, para no leakear existencia) |
| **409** | Conflicto (estado del recurso no permite la acción; **comprobante duplicado** `{duplicado}`; 2ª NC bloqueada; reintento sobre comprobante que no está en error/rechazado) |
| **422** | Entidad no procesable (reintentar SUNAT sin XML ni ítems; CDR vacío/corrupto) |
| **500** | Error interno (catch genérico) |
| **502** | Error de upstream (Google Directions / apisperu caído) |
| **503** | Servicio no disponible: `CRON_SECRET` ausente (cron), email/cert SUNAT/token apisperu no configurados |

### 1.3 Cuándo usar `export const dynamic = "force-dynamic"`

Necesario en handlers que **leen sesión** o **dependen de datos cambiantes**. Sin él, Next.js puede cachear la respuesta a nivel CDN/edge y devolver datos viejos.

**A jun 2026, prácticamente TODOS los route handlers nuevos declaran `export const dynamic = "force-dynamic"`** — es ya el patrón de facto del proyecto. Verificado en los grupos comprobantes/`*`, facturas/`*`, incentivos, metas/`*`, reportes/`*`, producción/`*`, notificaciones/`*`, buscar, mi-dia, clientes/`[id]`/perfil, consulta-documento, sunat/empresas y los 4 cron.

**Excepciones puntuales (sin `force-dynamic`):**
- `api/version/route.ts` — usa headers `Cache-Control: no-store` en su lugar (intencional).
- `api/resumen-diario/route.ts`, `api/reportes/ventas/route.ts` y `api/reportes/ventas/export-xlsx/route.ts` — leen sesión y datos en vivo igual; conviene agregarles `force-dynamic` por consistencia (deuda menor, no rompe nada porque devuelven attachments/JSON con scope por sesión).
- `api/despacho/reordenar/route.ts` — sin `force-dynamic` (es PATCH, no cacheable).

---

## 2. Tabla maestra de endpoints

Resumen de los **~70 route handlers** del sistema agrupados por feature. La regla de oro: el scoping por rol vive en CADA handler (Neon NO tiene RLS — la BD no sabe de roles). Cada handler hace `await auth()` y, si aplica, revisa `session.user.role` y/o ownership (`asesor_id`, `repartidor_id`, dueño de la cartera).

**Mapa de grupos:**
- **2.1** `pedidos/*` — CRUD, transiciones, historial, orden firmada
- **2.2** `despacho/*` — vista admin (kanban + asignación + ruta)
- **2.3** `repartidor/*` — endpoint del motorizado
- **2.4** `clientes/*` — directorio + perfil 360°
- **2.5** `productos/*` y `precios/*` — catálogo (precios `@deprecated`)
- **2.6** `users/*`
- **2.7** `produccion/*` — cola + pesos + listo (rol `produccion`)
- **2.8** `comprobantes/*` — SUNAT (emisión, NC, baja, resumen, PDF/XML/CDR, correo, Excel)
- **2.9** `facturas/*` + `cobranzas/aging` — cobranzas
- **2.10** `incentivos`, `metas/*` — metas e incentivos
- **2.11** `reportes/ventas*`, `resumen-diario`, `dashboard/pedidos` — reportes
- **2.12** `notificaciones/*` — campanita
- **2.13** Utilitarios — `buscar` (Cmd+K), `mi-dia`, `consulta-documento`, `sunat/empresas`, `settings`, `version`, `auth/logout`
- **2.14** `cron/*` — 4 jobs protegidos por `CRON_SECRET`

### 2.1 `/api/pedidos/*` — CRUD y transiciones

| Path | Método | Auth | Rol | Body | Side effects DB | Side effects externos |
|---|---|---|---|---|---|---|
| `/api/pedidos` | POST | ✅ | Cualquier auth | `PedidoSchema` (cliente, asesorId, items, ...) | INSERT pedidos + N×INSERT pedido_items | - |
| `/api/pedidos/[id]` | PATCH | ✅ | Admin (cualquiera) / Asesor (suyos) / Repartidor (asignados) | `UpdateSchema` (parcial) | UPDATE pedidos dinámico, sync estado↔entregado | - |
| `/api/pedidos/[id]` | DELETE | ✅ | Admin (cualquiera) / Asesor (suyos). Repartidor: ❌ | - | DELETE FROM pedidos (CASCADE elimina items) | - |
| `/api/pedidos/print` | GET | ✅ | Asesor (sus pedidos) / Admin | - | SELECT con filtros | - |
| `/api/pedidos/[id]/iniciar-viaje` | POST | ✅ | Repartidor asignado / Admin | `{driverLat?, driverLng?}` | UPDATE estado='En_Camino', timestamps, ETA | Google Directions (1×) |
| `/api/pedidos/[id]/entregar` | POST | ✅ | Cualquier auth (el ownership real lo arrastra el flujo) | `{resultado, razon_fallo?}` | UPDATE estado, entregado, entregado_por, entregado_at; **crea cobranza** (`crearFacturaParaPedido`); **emite notificación** `pedido_entregado`/`pedido_fallido` a la asesora; chequea `meta_diaria_alcanzada` | - |
| `/api/pedidos/[id]/entregar` | PATCH | ✅ | Repartidor asignado / Admin | - | UPDATE estado='Asignado', limpia timestamps (revertir) | - |
| `/api/pedidos/[id]/cancelar-viaje` | POST | ✅ | Repartidor asignado / Admin | - | UPDATE estado='Asignado', limpia ETA | - |
| `/api/pedidos/[id]/ediciones` | GET | ✅ | **Admin only** | - | SELECT `pedido_ediciones` (historial de correcciones, más reciente primero) | - |
| `/api/pedidos/[id]/guia-firmada` | POST | ✅ | Admin / Repartidor asignado / Asesora dueña | `multipart/form-data` (`foto`, ≤2MB, jpeg/png/webp/heic) | UPDATE `guia_firmada_data/_mime/_at` (base64 en DB); notifica `guia_firmada` a la asesora | - |
| `/api/pedidos/[id]/guia-firmada` | GET | ✅ | Admin / Repartidor (suyos) / Asesora (su cartera) | - | SELECT imagen → devuelve binario (`Content-Type` del mime) | - |

**✅ Resuelto:** `PATCH /api/pedidos/[id]` y `DELETE /api/pedidos/[id]` tienen `await auth()` + verificación de ownership al inicio. Asesor solo puede modificar sus propios pedidos (`asesor_id === userId`), repartidor solo los asignados (`repartidor_id === userId`), admin pasa siempre. **`DELETE` es solo admin** (jun 2026): asesor/repartidor reciben 403 (la asesora solo podía borrar los `Pendiente`, hoy el borrado quedó solo-admin). Cada PATCH que toca campos de DATOS del pedido **audita el diff** en `pedido_ediciones` vía `lib/pedido-historial.ts` (no-bloqueante; solo campos de `CAMPOS_AUDITABLES`, no el ruido del ciclo de vida).

### 2.2 `/api/despacho/*` — Vista admin

| Path | Método | Auth | Rol | Body | Side effects DB | Side effects externos |
|---|---|---|---|---|---|---|
| `/api/despacho` | GET | ✅ | Admin only | - | SELECT (pendientes + asignados + externos + repartidores) | - |
| `/api/despacho/asignar` | POST | ✅ | Admin only | `{pedido_ids[], repartidor_id}` | UPDATE pedidos (repartidor_id, estado, orden_ruta, distancia_km, duracion_estimada_min) | Google Directions (1× por pedido, fallback Haversine) |
| `/api/despacho/asignar-externo` | POST | ✅ | Admin only | `{pedido_id, nombre_delivery}` | UPDATE pedido (es_delivery_externo, delivery_externo_nombre, estado, repartidor_id=NULL) | - |
| `/api/despacho/asignar-externo` | PATCH | ✅ | Admin only | `{pedido_id, estado, razon_fallo?}` | UPDATE pedido (estado, entregado, entregado_at, razon_fallo) | - |
| `/api/despacho/asignar-externo` | DELETE | ✅ | Admin only | `{pedido_id}` | UPDATE pedido (es_delivery_externo=false, estado='Pendiente', repartidor_id=NULL) | - |
| `/api/despacho/optimizar-ruta` | POST | ✅ | Admin / Repartidor (de su ruta) | `{repartidor_id}` | UPDATE pedidos (orden_ruta, duracion_estimada_min) — NO toca distancia_km | Google Directions con waypoints=optimize:true (1×) |
| `/api/despacho/reordenar` | PATCH | ✅ | Admin only | `{repartidor_id, orden:[{pedido_id, orden_ruta}]}` | UPDATE pedidos (orden_ruta) | - |

### 2.3 `/api/repartidor/*`

| Path | Método | Auth | Rol | Body | Side effects DB | Side effects externos |
|---|---|---|---|---|---|---|
| `/api/repartidor/mi-ruta` | GET | ✅ | Cualquier auth (devuelve solo sus pedidos) | - | SELECT pedidos WHERE repartidor_id=userId AND fecha_pedido=hoy | - |

### 2.4 `/api/clientes/*`

| Path | Método | Auth | Rol | Body / Query | Side effects DB | Side effects externos |
|---|---|---|---|---|---|---|
| `/api/clientes` | GET | ✅ | Asesor (suyos) / Admin (todos) | `?q=` o `?page=&limit=&search=&asesor_id=` | SELECT clientes (filtra por asesor_id) | - |
| `/api/clientes` | POST | ✅ | Cualquier auth (asesor_id viene del session si no es admin) | `CreateSchema` | INSERT clientes | - |
| `/api/clientes/[id]` | GET | ✅ | Asesor (suyos) / Admin | - | SELECT cliente (verifica ownership) | - |
| `/api/clientes/[id]` | PATCH | ✅ | Asesor (suyos) / Admin (puede transferir) | Schema parcial | UPDATE cliente (validar destino si transfiere asesor_id) | - |
| `/api/clientes/[id]` | DELETE | ✅ | Asesor (suyos) / Admin | - | DELETE FROM clientes | - |
| `/api/clientes/[id]/pedidos` | GET | ✅ | Admin / Asesor (su cartera) | - | Valida ownership del cliente, luego SELECT pedidos (cliente_id o nombre) | - |
| `/api/clientes/[id]/perfil` | GET | ✅ | Admin / Asesor (su cartera) | - | Perfil 360°: cliente + stats (facturado/cobrado/pendiente/vencido) + pedidos + comprobantes (por `cliente_doc_num`) + cobranzas + top productos | - |

**✅ Resuelto:** `GET /api/clientes/[id]/pedidos` (y `/perfil`) **ahora validan ownership**: el asesor solo accede si el cliente es de su cartera (`asesor_id === userId`); si no, 404 (no leakea existencia). El hallazgo de "DEUDA MEDIA" de mayo está cerrado.

### 2.5 `/api/productos/*`

| Path | Método | Auth | Rol | Body | Side effects DB |
|---|---|---|---|---|---|
| `/api/productos` | GET | ❌ (público) | - | - | SELECT productos WHERE activo=TRUE; **devuelve también `codigo`, `precio_venta`, `precio_compra`** (jun 2026) |
| `/api/productos` | POST | ✅ | Admin only | `{nombre, categoria, unidad, precio_venta?, precio_compra?}` | INSERT productos; genera `codigo` (prefijo categoría + correlativo) |
| `/api/productos/[id]` | PATCH | ✅ | Admin only | `{nombre?, categoria?, unidad?, activo?, precio_venta?, precio_compra?, codigo?}` | UPDATE productos; al cambiar precio **preserva histórico** (cierra el vigente + inserta en `precios_productos`) |
| `/api/productos/[id]` | DELETE | ✅ | Admin only | - | UPDATE productos SET activo=FALSE (soft delete) |

**Soft delete deliberado** para preservar referencias históricas en `pedido_items`.

**`/api/precios` y `/api/precios/[id]` (`@deprecated`)**: el catálogo unificado (`/dashboard/catalogo`) movió precio/código al endpoint de productos. Estos siguen existiendo como red de seguridad pero ya nadie los consume desde la UI. Candidatos a borrar tras unas semanas sin regresiones.

### 2.6 `/api/users/*`

| Path | Método | Auth | Rol | Body / Query | Side effects DB |
|---|---|---|---|---|---|
| `/api/users` | GET | ✅ | Admin (todos) / Otro auth (`?role=X` para selects, sin campo `role` en respuesta) | `?role=` | SELECT users |
| `/api/users` | POST | ✅ | Admin only | `{name, password, role}` | INSERT users (bcrypt hash) |
| `/api/users/[id]` | PATCH | ✅ | Admin only | `{name?, password?, role?}` | UPDATE users (hashea password si presente) |
| `/api/users/[id]` | DELETE | ✅ | Admin only | - | Pre-check `pedidos.asesor_id=$1` → 409 si tiene; DELETE FROM users |

### 2.7 `/api/produccion/*` — cola del día + pesos (rol `produccion`)

Todos restringidos a `admin + produccion`. El rol `produccion` es la asistente que prepara/pesa la mercadería (Mejora 1, en producción desde 30 may 2026).

| Path | Método | Auth | Rol | Body / Query | Side effects DB |
|---|---|---|---|---|---|
| `/api/produccion/pedidos` | GET | ✅ | admin/produccion | `?fecha=&q=` | SELECT cola (`Pendiente`/`En_Produccion`/`Listo_Para_Despacho`) del día + items, ordenada por urgencia |
| `/api/produccion/pedidos/[id]/pesos` | PATCH | ✅ | admin/produccion | `{items:[{item_id, cantidad_real, unidad?, precio_unitario?}]}` | UPDATE `pedido_items` (cantidad/unidad/precio reales + `subtotal_real`); pasa el pedido a `En_Produccion`; sella `pesado_por`/`pesado_at` |
| `/api/produccion/pedidos/[id]/listo` | POST | ✅ | admin/produccion | - | Valida que TODOS los items tengan `cantidad_real`; estado → `Listo_Para_Despacho`; **notifica `listo_para_despacho`** a la asesora |
| `/api/produccion/pedidos/[id]/reabrir` | POST | ✅ | admin/produccion | - | Revierte `Listo_Para_Despacho` → `En_Produccion` |

### 2.8 `/api/comprobantes/*` — SUNAT (factura/boleta/NC + operaciones)

El grupo más grande. Todo lo de emisión/lectura está abierto a **`asesor` + `admin`**; las operaciones fiscales delicadas (reintentar, anular, resumen diario, consultar ticket) son **admin only**. **Scoping de la asesora (Antonio jun 2026): ve SOLO SUS comprobantes** (de sus pedidos `pedidos.asesor_id`, o los que ella misma emitió `emitido_por`), vía el helper `lib/comprobante-scope.ts:asesoraPuedeVerComprobante`. 404 (no 403) cuando no es suyo, para no revelar existencia. El admin ve todos.

| Path | Método | Auth | Rol | Qué hace |
|---|---|---|---|---|
| `/api/comprobantes` | GET | ✅ | admin (todos) / asesor (suyos) | Lista (LIMIT 100). Filtros `?tipo=01\|03\|07\|08`, `?empresa=`, `?pedido_id=`, `?cliente_doc_num=`. Devuelve vínculo NC↔factura (`referencia_*`, `tiene_nc`) y `emitido_por` |
| `/api/comprobantes/[id]` | GET | ✅ | admin / asesor (suyos) | Detalle + ítems para el PDF. **Ítems por prioridad: (1) XML firmado → (2) `pedido_items` → (3) línea global** (gotcha #18). Incluye `formaPago`, `fechaVencimiento`, `emisor` (de `getSunatConfig`) |
| `/api/comprobantes/[id]/xml` | GET | ✅ | admin / asesor (suyos) | Descarga el XML firmado (`xml_firmado_base64`) como attachment; 404 si no se envió |
| `/api/comprobantes/[id]/cdr` | GET | ✅ | admin / asesor (suyos) | Sirve el **ZIP crudo de la CDR** tal cual SUNAT lo entrega (gotcha #18); 404 si no hay CDR |
| `/api/comprobantes/[id]/enviar` | POST | ✅ | admin / asesor (suyos) | Envía PDF (`pdfBase64`, ≤7MB) + XML por correo (Brevo→SMTP). 503 si email no configurado |
| `/api/comprobantes/[id]/reintentar` | POST | ✅ | **admin only** | Reenvía a SUNAT comprobantes en `error`/`rechazado`, **reusando el mismo correlativo**. Reenvía el XML firmado original tal cual; si no hay, reconstruye desde `items_json`; si no hay nada → 422 (gotcha #19) |
| `/api/comprobantes/[id]/anular` | POST | ✅ | **admin only** | Comunicación de Baja (RA-) de **facturas** aceptadas ≤7 días. `{motivo}` → ticket SUNAT. (En la UI está **deshabilitada** a favor de la NC) |
| `/api/comprobantes/[id]/nota-credito` | POST | ✅ | admin / asesor (suyos) | Emite NC (07) sobre factura/boleta aceptada/observada. `{motivo, tipoNotaCredito?}`. **Bloquea una 2ª NC** (por `referencia_comprobante_id` o regex en observaciones, gotcha #19). Series propias FC0x/BC0x |
| `/api/comprobantes/[id]/emisor` | PATCH | ✅ | **admin only** | Reasigna la "asesora encargada" reescribiendo `emitido_por` (`{asesorId: uuid\|null}`; resuelve el nombre desde `users` con `role='asesor'`). Así el comprobante aparece en la lista de esa asesora (el scoping filtra por `emitido_por`); `null` lo deja en "—". NO toca XML/CDR/montos (3 jun 2026) |
| `/api/comprobantes/emitir` | POST | ✅ | asesor (sus pedidos) / admin | Emite factura/boleta **desde un pedido**. Precios CON IGV → ÷1.18. Valida cliente (RUC para factura; boleta <S/700 sin doc → "CLIENTES VARIOS"). Anti-duplicado → **409** `{duplicado}`. Factura → crea cobranza salvo `yaCobrado` |
| `/api/comprobantes/emitir-manual` | POST | ✅ | asesor / admin | Emite factura/boleta **standalone** (sin pedido). Mismas validaciones. Completa RUC del cliente en su ficha. Factura → cobranza (`crearFacturaStandalone`) |
| `/api/comprobantes/resumen-diario` | GET/POST | ✅ | **admin only** | GET: boletas del día pendientes de resumen. POST: genera/firma/envía el RC- a SUNAT (`{fecha, empresa, forzar?}`) con idempotencia (`lib/sunat/resumen-diario.ts`) |
| `/api/comprobantes/consultar-ticket` | POST | ✅ | **admin only** | `getStatus` de un ticket SUNAT (baja/resumen). Persiste en `resumenes_diarios` o marca el comprobante `anulado` si la baja fue aceptada |
| `/api/comprobantes/resumenes` | GET | ✅ | **admin only** | Lista los últimos 20 RC- enviados (para consultar su ticket días después) |
| `/api/comprobantes/export-xlsx` | GET | ✅ | admin (todos) / asesor (sus pedidos) | Reporte contable .xlsx multi-hoja. Filtros `?desde&hasta` (zona Lima) + tipo/empresa/cliente_doc_num. NC restan; rechazado/error/anulado fuera de sumas |

> **Detalle del módulo SUNAT real** (XML UBL 2.1 + firma .p12 + SOAP + CDR, 2 RUCs): ver §4.6 y `CLAUDE.md §16`.

### 2.9 `/api/facturas/*` y `/api/cobranzas/*` — cobranzas

"Facturas" aquí = **cobranzas internas** (deudas), NO los comprobantes fiscales. Scoping: asesor ve solo las suyas (`facturas.asesor_id = userId`); admin todas (con `?asesor_id=` para filtrar).

| Path | Método | Auth | Rol | Qué hace |
|---|---|---|---|---|
| `/api/facturas` | GET | ✅ | admin (todas) / asesor (suyas) | Lista (LIMIT 200) + stats por estado. Filtros `?estado=`, `?asesor_id=` |
| `/api/facturas` | POST | ✅ | asesor / admin | Cobranza manual (`crearFacturaStandalone`). Vínculo opcional a `cliente_id` y/o `comprobante_id` (deriva `numero_comprobante`) |
| `/api/facturas/[id]` | PATCH | ✅ | admin / asesor (suyas) | Edita `fecha_vencimiento`; recalcula estado (Pagada/Vencida/Pendiente) |
| `/api/facturas/[id]/pago` | POST | ✅ | admin / asesor (suyas) | Marca **Pagada**: fecha, `metodo_pago`, `pago_detalle`, captura `pago_img_base64` (≤400KB) |
| `/api/facturas/[id]/pago` | DELETE | ✅ | admin / asesor (suyas) | **Revierte** el pago (patrón "deshacer 5s") → Pendiente/Vencida; limpia método y captura |
| `/api/facturas/[id]/pago-imagen` | GET | ✅ | admin / asesor (suyas) | Sirve la captura del comprobante de pago (binario) |
| `/api/cobranzas/aging` | GET | ✅ | admin (todas) / asesor (suyas) | Aging en buckets (Por vencer · 0–30 · 31–60 · 61–90 · +90) + top-5 morosos por deuda vencida |

### 2.10 `/api/incentivos` y `/api/metas/*` — metas e incentivos

Medición por **VENTAS** (`created_at` del pedido, zona Lima), no por entregas (gotcha #8). Config en `settings.incentivos_config` (JSONB); overrides en `metas_asesoras`.

| Path | Método | Auth | Rol | Qué hace |
|---|---|---|---|---|
| `/api/incentivos` | GET | ✅ | admin / asesor | Config + progreso de meta de equipo + ranking mensual + racha semanal (scoped al usuario) |
| `/api/incentivos` | POST | ✅ | **admin only** | Guarda la config de incentivos (4 toggles + criterios + premios), zod `ConfigSchema` |
| `/api/metas` | GET | ✅ | asesor (su meta) / admin (`?asesor_id=`) | Meta del día/semana/mes + ventas reales + racha + bono + % de avance |
| `/api/metas/asesoras` | GET | ✅ | **admin only** | Lista de asesoras con meta efectiva + ventas del mes + override + bono (para la pantalla de config) |
| `/api/metas/override` | POST | ✅ | **admin only** | Setea/borra la meta mensual fija + bono de una asesora (`metas_asesoras`, mes `YYYY-MM-01`). Sin meta ni bono → borra la fila (vuelve a automática) |

### 2.11 Reportes, resumen del día, dashboard

| Path | Método | Auth | Rol | Qué hace |
|---|---|---|---|---|
| `/api/reportes/ventas` | GET | ✅ | **admin only** | Reporte de ventas (facturación ENTREGADA) por rango `?desde&hasta` (default: este mes). KPIs en dinero + ranking asesoras + top productos + por día/empresa/distrito (`lib/reportes/datos-ventas.ts`) |
| `/api/reportes/ventas/export-xlsx` | GET | ✅ | **admin only** | El mismo reporte como .xlsx de 4 hojas |
| `/api/resumen-diario` | GET | ✅ | **admin + produccion** | "Resumen del día" — pedidos del día + `totalesPorProducto` (qué preparar). Default: ayer |
| `/api/dashboard/pedidos` | GET | ✅ | cualquier auth (scope por rol) | Wrapper de `lib/data.ts:fetchFilteredPedidos` para refrescar la lista del dashboard |

**✅ Resuelto / cambio importante:** el viejo `/api/analytics` y `/api/panel-gerencial` **fueron eliminados** (el rediseño de Reportes los fusionó en `/api/reportes/ventas`; git los preserva). El hallazgo de mayo "analytics/resumen-diario abiertos a cualquier auth" está **cerrado**: `reportes/ventas` es **admin only** y `resumen-diario` quedó scopeado a **admin + produccion**.

### 2.12 `/api/notificaciones/*` — campanita

| Path | Método | Auth | Qué hace |
|---|---|---|---|
| `/api/notificaciones` | GET | ✅ | Últimas 30 notificaciones del usuario + `unreadCount` |
| `/api/notificaciones/[id]/leida` | PATCH | ✅ | Marca una como leída (solo las propias, `user_id = session`) |
| `/api/notificaciones/leer-todas` | POST | ✅ | Marca todas las propias como leídas |

Tipos (`TipoNotificacion` en `lib/notificaciones.ts`): `pedido_creado · listo_para_despacho · pedido_asignado · pedido_en_camino · pedido_entregado · pedido_fallido · guia_firmada · factura_vencida · factura_por_vencer · meta_diaria_alcanzada · meta_atrasada · cliente_inactivo · comprobante_rechazado · comprobante_error`. La campanita (`NotificationBell.tsx`) importa el tipo del backend para no desfasarse.

### 2.13 Utilitarios — búsqueda, mi-día, consulta de documento, settings, version

| Path | Método | Auth | Rol | Qué hace |
|---|---|---|---|---|
| `/api/buscar` | GET | ✅ | admin / asesor (repartidor 403) | Búsqueda global Cmd+K: TOP-5 de clientes/pedidos/comprobantes con scoping por rol. `?q=` (≥2 chars), ILIKE con escape |
| `/api/mi-dia` | GET | ✅ | asesor / admin | Panel "Mi día": pedidos a entregar hoy + cobranzas vencidas/hoy + clientes dormidos (≥20 días) + ventas del día. Scope al asesor |
| `/api/consulta-documento` | POST | ✅ | asesor / admin | Consulta RUC/DNI vía apisperu (server-side, token oculto). `{tipo, numero}`. Mapea errores del proveedor (404/429→CUOTA/503→TOKEN/502) |
| `/api/sunat/empresas` | GET | ✅ | asesor / admin | Datos PÚBLICOS del emisor (RUC + razón social) de ambas empresas (para el form embebido). NO expone cert/clave |
| `/api/settings` | GET | ✅ | cualquier auth | SELECT settings |
| `/api/settings` | POST | ✅ | **admin only** | UPSERT settings (zod `BaseLocationSchema`) |
| `/api/version` | GET | ❌ (público) | - | Lee `.next/BUILD_ID` (`Cache-Control: no-store`) para `VersionChecker` |
| `/api/auth/logout` | GET | - | - | NextAuth signOut + redirect a `/` |

### 2.14 `/api/cron/*` — 4 jobs protegidos por `CRON_SECRET`

NO usan `auth()`. En su lugar validan el header `Authorization: Bearer <CRON_SECRET>` que manda Vercel Cron: **si `CRON_SECRET` no está en el entorno → 503**; si no coincide → 401. Vercel Pro permite 40 crons (usamos 4). Schedules reales en `vercel.json`:

| Path | Schedule (UTC) | Lima | Qué hace |
|---|---|---|---|
| `/api/cron/facturas-vencidas` | `0 13 * * *` | 08:00 | Marca facturas Pendientes vencidas → `Vencida` + notifica; recordatorio de las que vencen mañana |
| `/api/cron/daily-digest-admin` | `30 13 * * *` | 08:30 | UNA notificación consolidada al admin (vencidas + vencen hoy + comprobantes en error + pedidos sin asignar). No spamea si todo en cero. **Además purga notificaciones leídas >30 días** |
| `/api/cron/recordatorios-asesoras` | `0 17 * * *` | 12:00 | Por asesora: meta atrasada (<50%) · clientes inactivos (14–21 días) · facturas suyas por vencer (3 días) |
| `/api/cron/resumen-diario-sunat` | `0 7 * * *` | 02:00 | Para cada empresa: envía a SUNAT el Resumen Diario (RC-) de las boletas de AYER (idempotente vía `lib/sunat/resumen-diario.ts`) |

---

## 3. Reference detallado por endpoint

Para cada endpoint con lógica no trivial, expandimos. Las expansiones de abajo cubren **pedidos + despacho** (el core operativo, schemas zod incluidos). Para los grupos nuevos (comprobantes, cobranzas, incentivos/metas, reportes, producción) la tabla de §2 ya trae el detalle de auth/rol/efectos; la lógica fina vive en los helpers de `src/lib/` listados en §4.5–§4.8 (SUNAT/apisperu/Brevo/Gemini) y en `cobranzas.ts` / `metas.ts` / `incentivos.ts` / `comprobante-scope.ts` / `pedido-historial.ts`.

### 3.1 `POST /api/pedidos` — crear pedido

**Archivo:** `src/app/api/pedidos/route.ts:63-130`

**Schema** (líneas 7-39):

```typescript
const PedidoSchema = z.object({
  cliente: z.string().min(1, { message: "El cliente es requerido." }),
  clienteId: z.string().uuid().nullable().optional(),
  whatsapp: z.string().optional(),
  direccion: z.string().optional(),
  direccionMapa: z.string().optional(),
  distrito: z.string(),
  tipoCliente: z.string(),
  detalle: z.string().min(1, { message: "El detalle es requerido." }),
  horaEntrega: z.string().optional(),
  razonSocial: z.string().optional(),
  rucDni: z.string().optional(),
  notas: z.string().optional(),
  empresa: z.string(),
  fecha: z.string(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  asesorId: z.string().uuid({ message: "El ID del asesor no es válido." }),
  items: z.array(z.object({
    productoId: z.string().uuid(),
    nombre: z.string(),
    cantidad: z.number().positive(),
    unidad: z.string(),
  })).optional(),
});
```

**Lógica:**
1. Auth check (línea 65-71).
2. `safeParse` del body.
3. INSERT a `pedidos` con columnas literales (líneas 106-108):
   ```
   cliente, cliente_id, whatsapp, direccion, direccion_mapa, distrito,
   tipo_cliente, detalle, hora_entrega, razon_social, ruc_dni, notas,
   empresa, fecha_pedido, latitude, longitude, asesor_id
   ```
4. `RETURNING id` para obtener el UUID generado.
5. Si `items` no está vacío, loop INSERT en `pedido_items` (líneas 118-123).

**⚠️ No es transaccional** — si falla el 3er item de 5, los primeros 2 quedan persistidos.

### 3.2 `PATCH /api/pedidos/[id]` — update genérico

**Archivo:** `src/app/api/pedidos/[id]/route.ts:38-128`

**Schema** dinámico — todas las columnas opcionales:

```typescript
const UpdateSchema = z.object({
  cliente: z.string().min(1).optional(),
  whatsapp: z.string().optional().nullable(),
  // ... ~25 campos ...
  estado: z.enum(["Pendiente", "Asignado", "En_Camino", "Entregado", "Fallido"]).optional(),
  repartidor_id: z.string().uuid().nullable().optional(),
  // ...
});
```

**Sincronización estado ↔ entregado** (líneas 80-114):

```typescript
if (dataToUpdate.estado) {
  dataToUpdate.entregado = dataToUpdate.estado === "Entregado";

  if (dataToUpdate.estado === "Entregado" || dataToUpdate.estado === "Fallido") {
    if (!dataToUpdate.entregado_por) {
      const session = await auth();
      dataToUpdate.entregado_por = session?.user?.name || "Desconocido";
    }
    dataToUpdate.entregado_at = new Date().toISOString();
  }

  if (dataToUpdate.estado === "Pendiente") {
    dataToUpdate.entregado_por = null;
    dataToUpdate.entregado_at = null;
    dataToUpdate.razon_fallo = null;
    dataToUpdate.repartidor_id = null;
    dataToUpdate.orden_ruta = null;
  }

  if (dataToUpdate.estado === "Fallido" && !dataToUpdate.razon_fallo) {
    return NextResponse.json(
      { error: "Se requiere una razón para marcar como 'Fallido'." },
      { status: 400 }
    );
  }
}
```

**Construcción dinámica del UPDATE** (líneas 117-128):

```typescript
const updateEntries = Object.entries(dataToUpdate).filter(
  (entry) => entry[1] !== undefined
);

const setClauses = updateEntries
  .map(([key], index) => `${key} = $${index + 1}`)
  .join(", ");

const params = updateEntries.map((entry) => entry[1]);
const query = `UPDATE pedidos SET ${setClauses} WHERE id = $${params.length + 1}`;
params.push(id);
await sql.query(query, params);
```

**Vulnerabilidad potencial**: `key` viene de `Object.entries(parsedData.data)` — está limitado por las keys del schema zod, así que no hay SQL injection.

### 3.3 `POST /api/pedidos/[id]/iniciar-viaje` — calcular ETA

**Archivo:** `src/app/api/pedidos/[id]/iniciar-viaje/route.ts:9-148`

**Cascada para elegir origen del ETA** (líneas 57-90):

```typescript
let origenLat: string | null = driverLat;
let origenLng: string | null = driverLng;

if (!origenLat || !origenLng) {
  // 1. Último pedido entregado del día por este repartidor
  const pedidoAnterior = await sql`
    SELECT latitude, longitude FROM pedidos
    WHERE repartidor_id = ${session.user.id}
      AND fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
      AND estado = 'Entregado'
      AND latitude IS NOT NULL
    ORDER BY entregado_at DESC
    LIMIT 1
  `;
  if (pedidoAnterior.length > 0) {
    origenLat = pedidoAnterior[0].latitude;
    origenLng = pedidoAnterior[0].longitude;
  }
}

if (!origenLat || !origenLng) {
  // 2. Env vars BASE_LATITUDE/BASE_LONGITUDE
  origenLat = process.env.BASE_LATITUDE || "-12.0553";
  origenLng = process.env.BASE_LONGITUDE || "-77.0451";
}
```

**Cascada:** GPS real → último pedido entregado hoy → env vars base → hardcoded Lima.

**Llamada a Google Directions** (líneas 94-104):

```typescript
const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${origenLat},${origenLng}&destination=${pedido.latitude},${pedido.longitude}&key=${googleMapsServerKey}&language=es&region=pe&mode=driving`;

const directionsRes = await fetch(directionsUrl);
const directionsData = await directionsRes.json();

if (directionsData.status === "OK" && directionsData.routes.length > 0) {
  const durationSeconds = directionsData.routes[0].legs[0].duration.value;
  const etaDate = new Date(Date.now() + durationSeconds * 1000);
  horaLlegadaEstimada = etaDate.toISOString();
}
```

**Si Google falla**, no hay fallback — `horaLlegadaEstimada` queda `null` y el repartidor verá "ETA no disponible".

**Retorna URLs de navegación externa** (líneas 137-142):

```typescript
const navUrls = lat && lng ? {
  googleMaps: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
  waze: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
} : null;
```

### 3.4 `POST /api/despacho/asignar` — asignar pedidos con cálculo de distancia

**Archivo:** `src/app/api/despacho/asignar/route.ts:33-141`

**Pre-procesamiento** (líneas 44-78):
1. Obtener `baseLocation` desde `settings.base_location` (con fallback env vars y luego centro de Lima).
2. Calcular `currentOrden = MAX(orden_ruta) + 1` para el repartidor hoy.
3. Cargar coords de TODOS los pedidos a asignar en un solo SELECT.

**Loop por cada pedido** (líneas 80-128):

```typescript
for (const pedidoId of pedido_ids) {
  currentOrden++;
  const coords = coordsMap.get(pedidoId);

  let distanciaKm: number | null = null;
  let duracionMin: number | null = null;

  if (coords && googleKey) {
    try {
      const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${baseLocation.lat},${baseLocation.lng}&destination=${coords.lat},${coords.lng}&key=${googleKey}&language=es&region=pe&mode=driving`;
      const directionsRes = await fetch(directionsUrl);
      const directionsData = await directionsRes.json();

      if (directionsData.status === "OK" && directionsData.routes.length > 0) {
        const leg = directionsData.routes[0].legs[0];
        distanciaKm = Math.round((leg.distance.value / 1000) * 100) / 100;
        duracionMin = Math.round(leg.duration.value / 60);
      }
    } catch {
      // Fallback Haversine
      if (coords) {
        distanciaKm = haversineKm(baseLocation.lat, baseLocation.lng, coords.lat, coords.lng);
        duracionMin = Math.round((distanciaKm / 30) * 60);  // ~30 km/h promedio Lima
      }
    }
  } else if (coords) {
    distanciaKm = haversineKm(baseLocation.lat, baseLocation.lng, coords.lat, coords.lng);
    duracionMin = Math.round((distanciaKm / 30) * 60);
  }

  await sql`
    UPDATE pedidos
    SET repartidor_id = ${repartidor_id},
        estado = 'Asignado',
        orden_ruta = ${currentOrden},
        distancia_km = ${distanciaKm},
        duracion_estimada_min = ${duracionMin}
    WHERE id = ${pedidoId}
      AND fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
  `;
}
```

**Fórmula Haversine** (líneas 144-156):

```typescript
function haversineKm(lat1, lng1, lat2, lng2): number {
  const R = 6371; // Radio de la Tierra en km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}
```

**⚠️ Duplicación:** Haversine está solo aquí, no en `optimizar-ruta`. Centralizar en `lib/utils.ts`.

### 3.5 `POST /api/despacho/optimizar-ruta` — TSP heurístico de Google

**Archivo:** `src/app/api/despacho/optimizar-ruta/route.ts:31-238`

**Lógica:**

1. Obtener pedidos activos del repartidor (NOT IN Entregado/Fallido, con coords).
2. Si solo 1 pedido → calcular distancia directa y retornar.
3. Si ≥2 pedidos → llamar a Google Directions con waypoints:

```typescript
const maxWaypoints = 23;  // Google permite max 25 (origin + destination + 23 intermediate)
const pedidosToOptimize = pedidos.slice(0, maxWaypoints + 2);

const origin = `${baseLocation.lat},${baseLocation.lng}`;
const waypointCoords = pedidosToOptimize.map(p => `${p.latitude},${p.longitude}`);
const destination = waypointCoords[waypointCoords.length - 1];
const intermediateWaypoints = waypointCoords.slice(0, -1);

const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&waypoints=optimize:true|${intermediateWaypoints.join("|")}&key=${googleKey}&language=es&region=pe&mode=driving`;

const directionsRes = await fetch(directionsUrl);
const route = directionsData.routes[0];
const waypointOrder = route.waypoint_order;  // Array de índices reordenados por Google
const legs = route.legs;
```

4. Reconstruir el orden óptimo mapeando `waypointOrder` de vuelta a `pedidoId`.
5. Calcular `duracion_estimada_min` **acumulada** (no por tramo) — para que el repartidor vea "este cliente está a 23 min total de la base".
6. UPDATE solo `orden_ruta` y `duracion_estimada_min`. **NO toca `distancia_km`** (preserva la métrica original "distancia desde la base").

```typescript
for (const item of orderedPedidos) {
  await sql`
    UPDATE pedidos
    SET orden_ruta = ${item.orden_ruta},
        duracion_estimada_min = ${item.duracion_min}
    WHERE id = ${item.pedido_id}
      AND repartidor_id = ${repartidor_id}
  `;
}
```

7. Si hay >25 pedidos, los excedentes se asignan secuencialmente sin optimización (líneas 213-222).

**Retorna:**
```json
{
  "message": "Ruta optimizada: 8 pedidos reordenados.",
  "orden_optimizado": [
    { "pedido_id": "...", "orden_ruta": 1, "distancia_km": 2.4, "duracion_min": 8, "cliente": "..." },
    ...
  ],
  "distancia_total_km": 23.7,
  "duracion_total_min": 95
}
```

### 3.6 `POST /api/pedidos/[id]/entregar` y PATCH (revert)

**Archivo:** `src/app/api/pedidos/[id]/entregar/route.ts`

**Schema con refine condicional** (líneas 9-15):

```typescript
const EntregarSchema = z.object({
  resultado: z.enum(["Entregado", "Fallido"]),
  razon_fallo: z.string().min(5, "La razón debe tener al menos 5 caracteres.").optional(),
}).refine(
  (data) => data.resultado !== "Fallido" || (data.razon_fallo && data.razon_fallo.length >= 5),
  { message: "Debes indicar la razón por la que no se entregó.", path: ["razon_fallo"] }
);
```

**POST** (líneas 32-105):
- Verifica `pedido.estado` ∈ `["Asignado", "En_Camino", "Pendiente"]`.
- Si `'Entregado'`: UPDATE `estado, entregado=TRUE, entregado_por, entregado_at, razon_fallo=NULL`.
- Si `'Fallido'`: UPDATE `estado, entregado=FALSE, razon_fallo, entregado_por, entregado_at`.

**PATCH (revert)** (líneas 107-156):
- Verifica `pedido.estado` ∈ `["Entregado", "Fallido"]`.
- UPDATE: `estado='Asignado'`, limpia `entregado*`, `razon_fallo`, `inicio_viaje_at`, `hora_llegada_estimada`.

### 3.7 `POST /api/pedidos/[id]/cancelar-viaje`

**Archivo:** `src/app/api/pedidos/[id]/cancelar-viaje/route.ts`

**Restricción estricta:** solo permite origen `En_Camino` (líneas 41-46).

UPDATE: `estado='Asignado', inicio_viaje_at=NULL, hora_llegada_estimada=NULL`.

### 3.8 `/api/despacho/asignar-externo` — 3 métodos en un archivo

**POST** (líneas 8-37): asignar.
**PATCH** (líneas 40-79): actualizar estado (Entregado/Fallido).
**DELETE** (líneas 82-110): desasignar (volver a Pendiente).

**Crítico:** `repartidor_id` queda `NULL` en pedidos externos.

### 3.9 `/api/settings` — UPSERT pattern

**Schema** (líneas 31-39):

```typescript
const BaseLocationSchema = z.object({
  key: z.literal("base_location"),
  value: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().min(1),
    name: z.string().min(1),
  }),
});
```

**UPSERT** (líneas 64-69):

```typescript
await sql`
  INSERT INTO settings (key, value, updated_at)
  VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
  ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(value)}::jsonb, updated_at = NOW()
`;
```

### 3.10 `/api/reportes/ventas` — reporte de ventas (reemplazó a `/api/analytics`)

**Archivo:** `src/app/api/reportes/ventas/route.ts` (datos en `lib/reportes/datos-ventas.ts`). **Admin only.**

El viejo `/api/analytics` (8+ queries de KPIs/ranking/top productos, abierto a cualquier auth) **fue eliminado** en el rediseño de Reportes. Lo reemplaza `obtenerReporteVentas(desde, hasta)` — única fuente de cifras para el JSON, el Excel (`export-xlsx`, 4 hojas) y el PDF. Mide **facturación ENTREGADA** (`COALESCE(subtotal_real, subtotal)` de pedidos `Entregado` por `fecha_pedido`), coherente con que los reportes de admin miden entregas (gotcha #8), no `created_at` (eso es para las metas de la asesora).

Query `?desde&hasta` (YYYY-MM-DD; default: este mes). Devuelve KPIs en dinero (facturado, ticket promedio, % de entrega), ranking de asesoras, top productos, y series por día/empresa/distrito.

### 3.11 `/api/resumen-diario`

**Archivo:** `src/app/api/resumen-diario/route.ts`. **Admin + produccion** (ya no abierto a cualquier auth).

Default fecha: **ayer** (no hoy). Reporta:
- Pedidos del día con sus items.
- KPIs (total, entregados, pendientes).
- **Totales por producto** del día (`totalesPorProducto` = `SUM(cantidad) GROUP BY producto, unidad`) — el "cuánto preparar". Es la fuente de la pantalla `/dashboard/resumen` (abierta a admin + produccion) y de la pestaña "Día a día" de Reportes.

### 3.12 `/api/dashboard/pedidos`

Wrapper trivial de `lib/data.ts:fetchFilteredPedidos`. Existe porque el componente cliente del dashboard hace `fetch('/api/dashboard/pedidos?...')` para refrescar la lista sin recargar la página.

---

## 4. Integraciones externas detalladas

### 4.1 Google Maps Platform

**4 usos confirmados:**

#### A. Geocoding inverso (cliente, MapInput)

- **Cuándo:** click o drag en el mapa → convertir lat/lng → dirección legible.
- **Cómo:** `new google.maps.Geocoder().geocode({ location })` (Maps JS API).
- **Key:** `NEXT_PUBLIC_MAPS_API_KEY`.
- **Costo:** parte del cargo de Maps JS (no se factura por geocoding cliente).

#### B. Places Autocomplete (cliente)

- **Cuándo:** input de dirección en `MapInput.tsx` y en `BaseLocationModal`.
- **Cómo:** `useJsApiLoader({ libraries: ['places'] })` + `<Autocomplete>` component.
- **Key:** `NEXT_PUBLIC_MAPS_API_KEY`.

#### C. Directions API simple (server)

- **Cuándo:**
  - Al asignar pedido (`POST /api/despacho/asignar`) — origin = baseLocation, destination = pedido.
  - Al iniciar viaje (`POST /api/pedidos/[id]/iniciar-viaje`) — origin = cascada (GPS → último entregado → base), destination = pedido.
- **Cómo:** `fetch('https://maps.googleapis.com/maps/api/directions/json?...')`.
- **Key:** `Maps_SERVER_KEY` (server-side, **nota el naming inusual** con M mayúscula y guion bajo).
- **Costo:** $5 USD por 1,000 requests (Maps Platform Pricing 2026).

#### D. Directions API con waypoint optimization (server)

- **Cuándo:** `POST /api/despacho/optimizar-ruta`.
- **Cómo:** mismo endpoint Directions pero con `waypoints=optimize:true|<coords>`.
- **Límite:** 25 stops totales (origin + destination + 23 intermediate). El código maneja overflow asignando secuencialmente.
- **Costo:** $10 USD por 1,000 requests (Advanced rate por waypoint optimization).

### 4.2 Variables de entorno de Google Maps

```bash
# Cliente
NEXT_PUBLIC_MAPS_API_KEY=AIzaSy...     # Permisos: Maps JS, Places, Geocoding (todos client-side)

# Server
Maps_SERVER_KEY=AIzaSy...              # Permisos: Directions API
# ⚠️ Naming inusual: M mayúscula + guion bajo. NO es MAPS_SERVER_KEY ni GOOGLE_MAPS_API_KEY.
```

**Recomendación:** crear 2 keys distintas con permisos restringidos (cliente solo lo necesario para evitar abuse, server solo Directions).

### 4.3 Neon Postgres

- **Driver:** `@neondatabase/serverless` v1.0.1 — HTTP (no Postgres binary protocol).
- **No es un pool** — instanciar `neon(connectionString)` por handler es barato y seguro.
- **Pooled vs Unpooled:**
  - `DATABASE_URL` (pooled): para la mayoría de handlers. Limita conexiones simultáneas pero comparte con PgBouncer.
  - `DATABASE_URL_UNPOOLED`: conexión directa, útil para transacciones largas o migraciones masivas. Hoy **no se usa** en el código activo.

### 4.4 Vercel

- **Deploy continuo** desde push a `main`.
- **`BUILD_ID`** se genera por cada deploy en `.next/BUILD_ID`.
- **`/api/version`** lee este archivo y lo expone — `VersionChecker.tsx` lo polea cada 60s.
- **Env vars** configuradas en Vercel Dashboard (las del `.env` local).

### 4.5 SUNAT — facturación electrónica (módulo real, 2 RUCs)

**Implementado y en producción** (Mejora 7, desde 30 may 2026). NO se usó un PSE de terceros: se portó el módulo real desde `conexipema-eventos` y se emite directo contra el webservice SOAP de SUNAT con el certificado `.p12` de cada empresa. Validado en BETA (factura 01, boleta 03, NC 07 → ACEPTADA con CDR).

**Archivos** (todos en `src/lib/sunat/`):

| Archivo | Rol |
|---|---|
| `index.ts` | `emitirComprobante()` — orquesta correlativo → XML → firma → SOAP → guarda en `comprobantes`. Series por empresa/tipo (Transavic F001/B001, Avícola F002/B002; NC FC0x/BC0x) |
| `config-transavic.ts` | `getSunatConfig(empresa)` — lee RUC/razón social/dirección/ubigeo/cert/clave SOL de env vars. Endpoints BETA vs producción |
| `contador.ts` | Correlativo atómico (`UPDATE … +1 RETURNING`) en `comprobantes_contador`, PK `(ruc, serie)` |
| `xml-builder.ts` | Genera XML UBL 2.1 (factura/boleta/NC + comunicación de baja) |
| `xml-signer.ts` | Firma XML-DSig con el `.p12` (`node-forge` + `xml-crypto`) |
| `soap-client.ts` | POST SOAP a SUNAT + parsea CDR; distingue "SUNAT caído" (`sunatCaido`) de rechazo de datos |
| `resumen-diario.ts` | Helper compartido del Resumen Diario (RC-) con idempotencia (lo usan el cron y el endpoint manual) |
| `parse-cpe-items.ts` | Parsea las líneas del XML firmado para el PDF/correo (gotcha #18) |
| `validacion-cliente.ts` | `esDniValido` / `esRucValido` (módulo 11) / `esReceptorIdentificado` |
| `duplicado.ts` | Detecta comprobante duplicado reciente (mismo cliente + tipo + monto) |
| `pdf-comprobante.ts` | PDF formato SUNAT (jsPDF, generado en cliente, sin QR) |

**Endpoints SOAP** (`config-transavic.ts`):
- **BETA**: `https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService?wsdl`
- **Producción**: `https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService?wsdl`

**Convención crítica de precios:** `pedido_items.precio_unitario` y `productos.precio_venta` se guardan **CON IGV**. Antes de mandar a SUNAT se divide entre 1.18 (en `comprobantes/emitir` y `emitir-manual`). Ver gotcha #10.

**Env vars** (en Vercel, NUNCA en el repo): `SUNAT_TRA_*` y `SUNAT_AVI_*` (RUC, razón social, dirección, ubigeo, SOL user/pass, cert `.p12` en base64 + clave), `SUNAT_ENVIRONMENT` (`beta`/`production`). `AUTO_EMITIR_COMPROBANTE` (flag opcional para emitir al cerrar el pedido). Detalle completo en `CLAUDE.md §4` y `§16`.

### 4.6 apisperu — consulta de RUC/DNI

**Archivo:** `src/lib/apisperu.ts`. Token server-side (`APISPERU_TOKEN`, cuenta `transavicdev@gmail.com`); la UI llama a `POST /api/consulta-documento` (el número va en el body, no en la URL, para no dejar PII en logs).

- `consultarRuc(ruc)` → razón social, dirección, estado, condición, ubigeo (auto-llena el form de cliente / emisión).
- `consultarDni(dni)` → nombres + apellidos.
- **Nunca lanza**: devuelve `{ ok:false, code, mensaje }` (`FORMATO`/`NO_ENCONTRADO`/`TOKEN`/`CUOTA`/`RED`) para que la UI siempre permita escribir a mano. `dniruc.apisperu.com/api/v1`.

### 4.7 Correo — Brevo (preferido) con fallback SMTP

**Archivos:** `src/lib/email.ts` (fachada) + `src/lib/brevo.ts`.

- `sendEmail()` usa **Brevo API v3** si `BREVO_API_KEY` está configurada (más confiable en Vercel — no abre conexiones SMTP); si no, cae a **nodemailer/SMTP** (`SMTP_HOST/USER/PASS`).
- `isEmailConfigured()` → la UI deshabilita el botón de envío si no hay ni Brevo ni SMTP.
- Sender verificado en Brevo (hoy `transavicdev@gmail.com`). Plan free 300 correos/día. Lo usa `POST /api/comprobantes/[id]/enviar` (PDF + XML adjuntos).
- Env: `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` (o `SMTP_*`).

### 4.8 Gemini Flash — IA comercial (asistente + insights)

**Archivos:** `src/lib/gemini.ts` (helper `callGemini` + `ClienteAnonymizer`) + `src/lib/insights.ts` (8 insights: 4 admin + 4 asesora, scoped). Endpoint: `GET /api/asistente-ia` (admin/asesor, cache 1h por scope `admin-*`/`asesor-{id}-*`).

- Modelo **`gemini-flash-latest`**; requiere `thinkingConfig: { thinkingBudget: 0 }` o las respuestas se truncan (gotcha #12). Free tier; cuenta dedicada `transavicdev@gmail.com`.
- **Privacy boundary**: las queries de asesora SIEMPRE filtran `WHERE asesor_id = session.user.id`; antes de mandar nombres a Gemini se anonimizan con `ClienteAnonymizer` ("Cliente A", "Cliente B"…).
- ⚠️ El cache de insights es **in-memory** y no sobrevive en Vercel serverless → bajo carga se topa el límite gratuito (429). Degrada bien (muestra datos crudos). Fix pendiente: persistir en DB. Ver gotcha #16.
- Env: `GEMINI_API_KEY`.

### 4.9 Próximas integraciones (no implementadas)

| Servicio | Para qué | Estado |
|---|---|---|
| **Pusher Channels** | Se evaluó para tracking GPS en vivo | ❌ Descartado — el tracking salió con polling (cero infra, $0) |
| **Capacitor** | Wrapper Android de `/mi-ruta` para GPS en background (iOS bloquea PWAs) | ✅ En producción (4 jun 2026) — carpeta `android/` en `main`, app publicada en Google Play (Prueba Interna). Tabla `rider_locations` + endpoint de ubicación, ya en `main` |

> SUNAT y Gemini ya NO son "próximas" — están en producción (§4.5, §4.8).

---

## 5. Offline queue — referencia técnica

### 5.1 Estructura del archivo

`src/lib/offline-queue.ts` exporta:

| Función | Para qué |
|---|---|
| `isOnline()` | `navigator.onLine` con fallback `true`. |
| `enqueueAction(type, pedidoId, expectedEstado, payload)` | Agrega acción a la queue en localStorage. |
| `getQueueCount()` | Número de acciones pendientes. |
| `getQueue()` | Retorna el array completo (para UI). |
| `syncQueue()` | Itera la queue y reintenta. Retorna `{synced, failed, conflicts}`. |
| `removeAction(id)` | Elimina una acción por su UUID. |
| `subscribeToQueueChanges(cb)` | Pub-sub para que la UI reaccione a cambios. |

### 5.2 Constantes

```typescript
const STORAGE_KEY = "transavic_offline_queue";
const MAX_RETRIES = 3;
```

### 5.3 Tipos de acciones soportadas

```typescript
type QueuedActionType = "entregar" | "fallido" | "iniciar-viaje";
```

**No están soportadas** (acciones que se hacen solo online):
- `cancelar-viaje`
- `revertir` (PATCH /entregar)
- creación o edición de cliente
- asignación de pedidos
- cualquier otra mutación

### 5.4 Flujo de sync — pseudocódigo

```
syncQueue():
  if !isOnline(): return { synced: 0, failed: 0, conflicts: [] }
  queue = JSON.parse(localStorage[STORAGE_KEY] || '[]')
  result = { synced: 0, failed: 0, conflicts: [] }

  for action in queue:
    { url, body } = buildRequest(action)

    try:
      res = await fetch(url, { method: 'POST', body })

      if res.ok:
        removeAction(action.id)
        result.synced++

      elif res.status in [400, 409]:
        removeAction(action.id)              # estado cambió en servidor, descartar
        result.conflicts.push({ action, reason: await res.text() })

      else:                                  # 5xx
        action.retries++
        if action.retries >= MAX_RETRIES:
          removeAction(action.id)
          result.failed++
        else:
          updateAction(action)

    except (network error):
      action.retries++
      if action.retries >= MAX_RETRIES:
        removeAction(action.id)
        result.failed++
      else:
        updateAction(action)

  return result
```

### 5.5 Conflict resolution

Caso 1: el admin revirtió el pedido a `Asignado` (de `Entregado`). Cuando vuelve la señal, la acción encolada `entregar` con `expectedEstado='Asignado'` se envía → servidor responde 200 OK → todo bien.

Caso 2: el admin asignó el pedido a otro repartidor. Cuando vuelve la señal, la acción `entregar` se envía → servidor verifica `repartidor_id !== session.user.id` → responde 403 (verbo distinto a 400/409 pero el código actual lo trata como network error y reintenta → max retries → discard). **Pendiente:** mejorar el código para tratar 403 como conflict, no como network error.

---

## 6. Patrones de duplicación detectados

Áreas con duplicación que justifican refactor:

| Patrón duplicado | Apariciones | Sugerencia |
|---|---|---|
| Lectura de `settings.base_location` con fallback | `api/despacho/route.ts`, `api/despacho/asignar/route.ts`, `api/despacho/optimizar-ruta/route.ts`, `api/repartidor/mi-ruta/route.ts` | `lib/api.ts:getBaseLocation()` |
| Auth check + role check | ~20 endpoints | `lib/api.ts:requireAuth(session, roles?)` o middleware factory |
| Construcción de Google Directions URL + parsing | `api/despacho/asignar/route.ts`, `api/despacho/optimizar-ruta/route.ts`, `api/pedidos/[id]/iniciar-viaje/route.ts` | `lib/google-directions.ts:fetchDirections(origin, destination, options?)` |
| Fórmula Haversine | `api/despacho/asignar/route.ts` (solo) | Mover a `lib/utils.ts:haversineKm()` y reusarla en `optimizar-ruta` como fallback |
| Reinstanciación de `neon()` | Cada handler | Aceptable (es barato), pero podría centralizarse en `lib/db.ts:getSql()` |
| `parseFloat()` para lat/lng | Múltiples lugares | `lib/utils.ts:parseCoords(row)` |

---

## 7. Cómo verificar que este documento sigue vigente

```bash
# 1. Listar todos los endpoints actuales
find src/app/api -name "route.ts" | sort

# 2. ¿Hay APIs nuevas no documentadas en este doc?
find src/app/api -name "route.ts" -newer docs/arquitectura/05-apis-e-integraciones.md

# 3. ¿Sigue el patrón de force-dynamic en endpoints críticos?
grep -L "force-dynamic" src/app/api/pedidos/**/route.ts src/app/api/despacho/**/route.ts

# 4. ¿Hay APIs sin await auth() (excepto las explícitamente públicas)?
grep -L "await auth()" src/app/api/**/*.ts

# 5. ¿Sigue Google Directions con waypoints=optimize:true?
grep "optimize:true" src/app/api/despacho/

# 6. ¿Sigue el fallback Haversine en asignar?
grep -A 5 "haversineKm" src/app/api/despacho/asignar/route.ts

# 7. ¿Aparecen nuevos status codes raros?
grep -oP 'status: \d+' src/app/api/**/*.ts | sort -u

# 8. ¿Los schemas zod siguen iguales?
grep -A 30 "const.*Schema = z.object" src/app/api/pedidos/route.ts

# 9. ¿Hay endpoints nuevos que llaman Google Maps?
grep -rln "maps.googleapis.com" src/app/api/

# 10. ¿La offline queue sigue con MAX_RETRIES=3?
grep "MAX_RETRIES" src/lib/offline-queue.ts

# 11. ¿Cuántos endpoints hay? (el doc dice ~70)
find src/app/api -name "route.ts" | wc -l

# 12. ¿Los 4 cron siguen protegidos por CRON_SECRET y sus schedules en vercel.json?
grep -rl "CRON_SECRET" src/app/api/cron/ ; cat vercel.json

# 13. ¿La asesora sigue viendo solo SUS comprobantes? (helper de scope)
grep -rln "asesoraPuedeVerComprobante" src/app/api/comprobantes/

# 14. ¿SUNAT sigue emitiendo directo (no PSE) contra los endpoints SOAP?
grep -n "billService?wsdl" src/lib/sunat/config-transavic.ts

# 15. ¿Brevo sigue como preferido con fallback SMTP?
grep -n "isBrevoConfigured" src/lib/email.ts
```

Si encuentras drift, actualiza las secciones afectadas y sube la fecha del header.

---

## 8. Hallazgos de auditoría (deudas a tratar)

| # | Hallazgo | Severidad | Archivo |
|---|---|---|---|
| 1 | ✅ ~~`PATCH /api/pedidos/[id]` y `DELETE /api/pedidos/[id]` sin `await auth()`~~ — **Resuelto 2026-05-13**: agregado auth + ownership check | ✅ Resuelto | `api/pedidos/[id]/route.ts` |
| 2 | ✅ ~~`GET /api/clientes/[id]/pedidos` sin verificación de ownership~~ — **Resuelto**: valida que el cliente sea de la cartera del asesor (404 si no) | ✅ Resuelto | `api/clientes/[id]/pedidos/route.ts` |
| 3 | ✅ ~~`/api/analytics` y `/api/resumen-diario` abiertos a cualquier auth~~ — **Resuelto/cambiado**: `analytics` eliminado (→ `reportes/ventas`, admin only); `resumen-diario` scopeado a admin+produccion | ✅ Resuelto | `api/reportes/ventas/route.ts`, `api/resumen-diario/route.ts` |
| 4 | `POST /api/pedidos` no es transaccional (puede dejar pedidos sin items completos) | 🟡 Media | `api/pedidos/route.ts:105-123` |
| 5 | Logout en dos rutas con destinos distintos | 🟢 Baja (UX) | `api/auth/logout/route.ts` vs `lib/actions.ts` |
| 6 | Roles dispersos en zod schemas (no centralizados) | 🟢 Baja (DX) | Múltiples |
| 7 | Tipo `Pedido` declara campos sin migración documentada (`razon_social`, etc.) | 🟢 Baja (deuda doc) | `lib/types.ts` |
| 8 | `Pedido` TS no incluye `cliente_id` ni `direccion_mapa` que SÍ se insertan en DB | 🟢 Baja | `lib/types.ts` |
| 9 | Tabla `clientes` sin migración de creación documentada | 🟡 Media (reproducibilidad) | `/scripts/` |
| 10 | DELETE de usuario solo checkea `asesor_id`, no `repartidor_id` | 🟡 Media | `api/users/[id]/route.ts` |
| 11 | offline-queue trata 403 como network error, no como conflict | 🟢 Baja | `lib/offline-queue.ts` |
| 12 | Haversine y getBaseLocation duplicados en múltiples handlers | 🟢 Baja (DX) | Múltiples |

---

## Final de la documentación de arquitectura

Estos 5 documentos cubren:

- **01-vision-general.md** — stack, deployment, decisiones macro.
- **02-modelo-de-datos.md** — tablas, schema, decisiones de schema, migraciones.
- **03-autenticacion-y-roles.md** — NextAuth, JWT, scoping, roles.
- **04-flujos-de-negocio.md** — vida del pedido, máquina de estados, UX por rol.
- **05-apis-e-integraciones.md** — referencia de endpoints + Google Maps + offline queue (este documento).

Para overview de los 5 → `README.md` del mismo directorio.
Para gotchas operativos del día a día → `CLAUDE.md` en la raíz.
