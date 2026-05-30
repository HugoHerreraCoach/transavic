# Mejoras UX/Flujo Transavic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (ejecución inline en esta sesión). Steps usan checkbox (`- [ ]`).

**Goal:** Implementar las 11 mejoras de UX/flujo detectadas en las pruebas de navegador del 22-may-2026, todo en local (dev-hugo).

**Architecture:** Cambios incrementales sobre componentes existentes (DashboardLayout, comprobantes-client, table, precios-client, FloatingAssistant) + 1 endpoint nuevo (listar resúmenes) + wiring de notificaciones existentes. Sin migraciones nuevas (la tabla `resumenes_diarios` ya existe).

**Tech Stack:** Next.js 15, TypeScript, Tailwind v4, Neon (SQL directo).

**Verificación por tarea:** `npx tsc --noEmit` + `npx eslint <archivos>`; al final `npm run build`; spot-check en navegador (localhost:3000, sesión admin Antonio ya activa).

**Nota:** Item #7 (emitir comprobante desde pedido) YA EXISTE en `table.tsx` → solo verificar, no construir.

---

### Task 1: Menú lateral — caber sin desbordar + ocultar "Mis Metas" del admin

**Files:** Modify `src/components/DashboardLayout.tsx`

- [ ] Cambiar `Mis Metas` de `roles: ["asesor","admin"]` a `roles: ["asesor"]` (el admin usa Panel Gerencial; quita 1 ítem y la confusión de S/0).
- [ ] Reducir footprint vertical del nav para que entren ~10 ítems sin scroll en laptops (~700px): en `desktopLink` bajar `py-3`→`py-2`; en `renderGrouped` los grupos `pt-3`→`pt-2`; header de grupo `pt-2 pb-1`→`pt-1 pb-0.5`.
- [ ] Garantizar scroll usable: el `<nav>` ya es `overflow-y-auto`; añadir `min-h-0` al contenedor flex para que el scroll funcione cuando aún desborde.

**Verify:** tsc; en navegador, sidebar admin muestra los 4 grupos sin cortar; "Mis Metas" ya no aparece para admin.

---

### Task 2: Botón flotante IA no tapa contenido

**Files:** Modify `src/components/DashboardLayout.tsx` (padding del main) y `src/components/FloatingAssistant.tsx`

- [ ] En DashboardLayout, al `<main>`/contenedor de children añadir `pb-24` (deja aire para que el botón no tape acciones del fondo).
- [ ] En FloatingAssistant reducir tamaño (texto `text-sm`, padding menor) y `z-40` (debajo de modales `z-50`) para no competir con overlays.

**Verify:** tsc; en navegador, en Cobranzas/Comprobantes el botón no tapa botones de acción; modales (z-50) quedan por encima del botón.

---

### Task 3: Comprobantes — filtro por estado + ver motivo de rechazo (`mensaje_sunat`)

**Files:** Modify `src/app/dashboard/comprobantes/comprobantes-client.tsx`

- [ ] Añadir estado `filtroEstado` (default "all") y una fila de filtros ESTADO (Todos/Aceptado/Observado/Pendiente/Rechazado/Error/Anulado) igual a TIPO/EMPRESA. Filtrado client-side sobre `comprobantes` ya cargados (no tocar API).
- [ ] Aplicar el filtro: derivar `comprobantesFiltrados = comprobantes.filter(c => filtroEstado==="all" || c.estado===filtroEstado)` y usarlo en ambos renders (mobile + desktop) en lugar de `comprobantes`.
- [ ] Mostrar `mensaje_sunat`: en filas `rechazado`/`error`/`observado`, bajo el badge de estado, mostrar el mensaje truncado (`line-clamp-2 text-[10px] text-red-600`) con `title={c.mensaje_sunat}` (full en hover). Solo si `c.mensaje_sunat`.

**Verify:** tsc; en navegador, el filtro "Rechazado" deja solo rechazados; las filas error/rechazado muestran el motivo.

---

### Task 4: Truncar texto largo del pedido en Lista de Pedidos

**Files:** Modify `src/app/dashboard/table.tsx`

- [ ] Localizar el render de `pedido.detalle` (columna "Pedido"/card). Envolver en `<span className="line-clamp-3 ...">` con un botón "ver más/menos" por fila (estado local `expandido`), o `title={pedido.detalle}` + `line-clamp-3` si añadir estado es invasivo. Preferir line-clamp-3 + title (mínimo riesgo).

**Verify:** tsc; en navegador, los pedidos con texto largo (ej. "Rosa luz") se truncan a 3 líneas; hover muestra completo.

---

### Task 5: Aviso "productos sin precio" en Catálogo › Precios

**Files:** Modify `src/app/dashboard/precios/precios-client.tsx`

- [ ] Calcular cuántos productos no tienen `precio_venta` (null/0). Si >0, banner ámbar arriba: "⚠️ N producto(s) sin precio de venta — no sumarán a ventas/metas hasta asignarles uno." Reutilizar estilo de banners existentes.

**Verify:** tsc; en navegador, aparece el conteo (hay varios "—" en Pollo).

---

### Task 6: "Resúmenes enviados" — endpoint + lista en el modal

**Files:** Create `src/app/api/comprobantes/resumenes/route.ts`; Modify `src/app/dashboard/comprobantes/comprobantes-client.tsx` (ModalResumenDiario)

- [ ] GET `/api/comprobantes/resumenes?empresa=` → admin → `SELECT id, fecha_referencia, correlativo, ticket, estado, boletas_incluidas, created_at FROM resumenes_diarios WHERE ($empresa is null or empresa=$empresa) ORDER BY created_at DESC LIMIT 20`. Auth admin.
- [ ] En `ModalResumenDiario`: al abrir y al cambiar empresa, fetch de la lista; render bajo el form: tabla compacta (fecha · estado · ticket · "Consultar") con botón Consultar por fila que llama el endpoint `consultar-ticket` existente con `{empresa, ticket, resumenId}`.

**Verify:** tsc; en navegador, el modal lista resúmenes previos (si hay) y permite consultar; sin resúmenes, muestra "Sin resúmenes enviados".

---

### Task 7: Emitir comprobante desde pedido — VERIFICAR (ya existe)

**Files:** Read-only `src/app/dashboard/table.tsx`

- [ ] Verificar en navegador: en un pedido entregado, el botón "Emitir comprobante" abre el modal; si ya tiene comprobante, muestra badge "Facturado". No requiere código nuevo.

---

### Task 8: Notificaciones — emitir los 5 tipos declarados que nunca se disparan

**Files:** Modify `src/app/api/despacho/asignar/route.ts` (+ `asignar-externo`), `src/app/api/pedidos/[id]/iniciar-viaje/route.ts`, `src/app/api/produccion/pedidos/[id]/pesos/route.ts`, y el endpoint de guía firmada.

- [ ] `pedido_asignado`: en `despacho/asignar` (y `asignar-externo`), tras asignar repartidor_id, `crearNotificacion({ userId: repartidorId, tipo:"pedido_asignado", titulo:"Nuevo pedido asignado", mensaje:`${cliente} — ${distrito}`, link:"/dashboard/mi-ruta", pedidoId })`.
- [ ] `pedido_en_camino`: en `pedidos/[id]/iniciar-viaje`, notificar a los admins (o al asesor del pedido) que el pedido salió.
- [ ] `pesos_listos`: en `produccion/pedidos/[id]/pesos`, al registrar pesos, notificar a admins ("Pesos listos — {cliente}").
- [ ] `guia_firmada`: en el endpoint que guarda la firma de guía, notificar a admin/asesor.
- [ ] `meta_diaria_alcanzada`: SOLO si hay un punto de trigger limpio (al registrar venta que cruza la meta del día); si no es trivial, dejar documentado como pendiente (no forzar).

**Patrón de destinatarios:** para "admins", `SELECT id FROM users WHERE role='admin'` y crear una notificación por cada uno. `crearNotificacion` nunca lanza (no rompe el flujo).

**Verify:** tsc; al asignar un pedido en /despacho, al repartidor le llega la campanita; revisar tabla `notificaciones` por psql.

---

## Self-Review

- **Spec coverage:** 1(menú)✓ 2(Mis Metas)✓ 3(descubribilidad→Task1)✓ 4(filtro estado)✓ 5(mensaje_sunat)✓ 6(resúmenes)✓ 7(emit pedido=ya existe)✓ 8(productos sin precio)✓ 9(botón IA)✓ 10(truncar)✓ 11(notificaciones)✓ — los 11 cubiertos.
- **Orden de ejecución:** 1 → 2 → 3 → 4 → 5 → 6 → 8 → 7(verify), con tsc tras cada uno y `npm run build` + browser al final.
- **Riesgo mayor:** Task 8 (puntos de inserción correctos); meta_diaria_alcanzada puede quedar pendiente si no hay trigger limpio.
