# Audit profundo Transavic — Conexiones rotas + Roadmap priorizado

**Fecha**: 2026-05-27 · **Autor**: brainstorming (Claude + Hugo) · **Scope**: audit completo del negocio

## Resumen ejecutivo

Tres hallazgos rectores:

1. **El loop del dinero está roto.** Pedido → Factura → Cobranza → Cliente NO se cierra cuando la factura es "Contado" (la mayoría en la práctica). El sistema asume "Contado = pagado", pero el negocio real es "Contado = pagará después salvo aviso". Resultado: cobranzas invisibles, deuda real no medida.
2. **Cada área es una isla.** Cliente no tiene un perfil 360°, Pedido↔Comprobante↔Cobranza no se navega cruzado, no hay "acción rápida" desde la lista. El usuario hace 4 clics donde debería hacer 1.
3. **El sistema sabe cosas que no muestra.** Comprobantes rechazados sin aviso al emisor, cobranzas vencidas sin alerta al admin, "Mi día" para la asesora no existe (info distribuida en 3 pantallas). La info está; falta surfacing.

## Fricciones por rol

### Asesora (volumen alto — el sistema vive de ellas)
| # | Fricción | Estado hoy | Debería |
|---|---|---|---|
| F1 | Compartir ticket por WhatsApp al cliente | Modal `ticket-share-modal.tsx` sin `max-h`/`overflow-y` → imagen se corta, X no visible | `max-h-[90vh] overflow-y-auto` + X siempre visible |
| F2 | Repetir un pedido de cliente recurrente (mismo combo del lunes) | Rellenar desde cero en `/nuevo-pedido` | Botón "Duplicar" en cada pedido entregado, pre-carga cliente + ítems |
| F3 | Capturar pago del cliente | Ir a `/cobranzas` → "Registrar manual" → retipear nombre del cliente | Acción "Cobrado" desde la fila del pedido/factura |
| F4 | Ver el día propio (pedidos en ruta, cobros pendientes, meta) | 3 pantallas distintas (`/dashboard`, `/cobranzas`, `/mis-metas`) | 1 panel "Mi día" en `/dashboard` |
| F5 | Aviso cuando un comprobante mío fue rechazado | No hay (lo detecta al refrescar) | Notificación + badge en menú |

### Admin (Antonio dueño)
| # | Fricción | Estado hoy | Debería |
|---|---|---|---|
| F6 | Exportar Excel para el contador | No existe | Botón "Exportar Excel" en `/comprobantes` (modelo: `conexipema/src/lib/sunat/generar-reporte-excel.ts`) |
| F7 | Cobranzas vencidas > N días | Visibles solo entrando a `/cobranzas` | Alerta en home + daily digest |
| F8 | Comprobantes en error que nadie reintentó | Listado pasivo, sin recordatorio | Contador en menú + alerta |
| F9 | Vista 360 de un cliente ("¿cuánto me debe X?") | Info fragmentada en 4 pantallas | Perfil con tabs: Datos · Pedidos · Comprobantes · Cobranzas · Deuda total |

### Repartidor
Único pendiente real: tracking en vivo (Capacitor + Pusher, ya planificado en Fase C — fuera de scope de este audit).

### Producción
En implementación per CLAUDE.md (estados `En_Produccion`, `Listo_Para_Despacho`). Está bien encaminado — fuera de scope.

## Conexiones faltantes (la raíz del problema)

| Conexión | Estado | Impacto |
|---|---|---|
| Factura **Contado** → Cobranza automática | ❌ no se crea (solo se crea para Crédito) | **CRÍTICO**: la mayoría son "Contado" pero el cliente paga después → cobranzas invisibles |
| Cobranza manual → **Cliente guardado** | ❌ campo de texto libre | Datos duplicados, sin historial cruzado |
| Cobranza manual → **Factura emitida** | ❌ sin selector de factura existente | No se sabe a qué documento corresponde el cobro |
| Cliente → **historial 360** (pedidos + comprobantes + cobranzas + deuda) | ❌ no existe | Admin no puede responder "¿cuánto me debe X?" en 5s |
| Comprobante ↔ Pedido relacionado | ⚠️ existe `pedido_id` pero sin link en UI | 2 clics innecesarios para navegar |
| Pedido entregado → Acción "cobrar" en línea | ❌ solo vía `/cobranzas` | 3 clics donde podría ser 1 |

> **API `/api/clientes?q=` YA existe** con búsqueda ILIKE + paginación. La cobranza manual sólo necesita conectarse — no requiere backend nuevo.

## Roadmap priorizado (impacto × esfuerzo)

### 🚨 P0 — Cierran el loop del dinero (~14h, esta semana)

| # | Ítem | Esfuerzo | Cambios principales |
|---|---|---|---|
| P0.1 | Toggle "Ya cobrado" en emisión + **toda factura Contado → cobranza por default** | 4h | `emit-client.tsx` (checkbox), `emit-manual/route.ts` + `lib/cobranzas.ts` (extender lógica), schema cobranzas si requiere flag |
| P0.2 | Cobranza manual: **autocomplete de clientes guardados + selector de factura existente** | 5h | `cobranzas-client.tsx` (modal): datalist clientes (usa `/api/clientes?q=`), select facturas (`/api/comprobantes` filtrado por cliente), wire al POST `/api/facturas` (extender schema para aceptar `cliente_id` + `comprobante_id` opcionales) |
| P0.3 | Modal compartir ticket: **`max-h` + scroll + X visible** | 1h | `ticket-share-modal.tsx`: card `max-h-[90vh] overflow-y-auto`, header sticky con X |
| P0.4 | **Exportar Excel** en `/comprobantes` (para contador) | 4h | nuevo endpoint `GET /api/comprobantes/export-xlsx` (usa `xlsx` lib, modelo conexipema), botón en `comprobantes-client.tsx` header; respeta filtros activos |

### 🔗 P1 — Conexiones 360 (~17h, semana siguiente)

| # | Ítem | Esfuerzo |
|---|---|---|
| P1.5 | **Perfil 360° del cliente** (`/dashboard/clientes/[id]` con tabs: Datos · Pedidos · Comprobantes · Cobranzas · Deuda) | 8h |
| P1.6 | **"Cobrado" desde la fila** de `/cobranzas` (1 clic marca pagada sin abrir modal) | 4h |
| P1.7 | **"Duplicar pedido"** (botón en pedidos entregados → `/nuevo-pedido?from=<id>`) | 3h |
| P1.8 | **Link cruzado Comprobante ↔ Pedido** (clickeable en ambas direcciones) | 2h |

### ⚡ P2 — UX que ahorra clics (~13h)

| # | Ítem | Esfuerzo |
|---|---|---|
| P2.9 | **Búsqueda global Cmd+K** (cliente / pedido / comprobante en 1 paso) | 8h |
| P2.10 | **Notificación de comprobante rechazado** al emisor (asesora/admin) | 3h |
| P2.11 | **Edición de pedido**: validar UX actual y aclarar qué se puede editar después de emitido | 2h |

### 📊 P3 — Vista del día + alertas (~16h)

| # | Ítem | Esfuerzo |
|---|---|---|
| P3.12 | **"Mi día" de la asesora** (1 panel: pedidos del día, mis cobranzas pendientes, meta, racha) | 8h |
| P3.13 | **Reporte de aging de cobranzas** (0-30/31-60/61-90/+90 días, exportable) | 4h |
| P3.14 | **Daily digest a Antonio** (cobranzas vencidas, comprobantes en error sin reintentar, pedidos atrasados) | 4h |

## Decisión de scope para implementación

**Esta sesión implementa P0** (4 ítems, ~14h) — cierra el loop del dinero, que es el dolor real reportado. P1/P2/P3 quedan como tareas separadas; cada una entrará en su propio brainstorm → plan → implementación cuando Hugo lo decida.

## Restricciones / no-objetivos

- **No tocar** módulo SUNAT (xml-builder/xml-signer/soap-client) — está BETA-validado, riesgo alto.
- **No cambiar** modelo de roles (admin/asesor/repartidor/produccion) — sólida.
- **No proponer** mega-refactor — focus en quitar fricción, no rediseñar el sistema.
- **Todo** local en dev-hugo; producción no se toca hasta merge explícito.
- **Migraciones** sólo si imprescindibles, vía `psql` (gotcha #13 Node 26).

## Criterio de éxito

Después de P0 deberían cumplirse:

1. Una asesora puede emitir una factura **Contado** y la cobranza queda registrada automáticamente (a menos que marque "ya cobrado").
2. "Registrar cobranza manual" autocompleta el cliente desde lo guardado y permite vincular una factura existente (sin retipear).
3. El modal de compartir ticket muestra el ticket completo + X visible para cerrar.
4. Antonio puede descargar un Excel de comprobantes del rango filtrado para el contador.

## Próximo paso

Invocar `writing-plans` con scope P0 → plan task-by-task. Tras el plan, ejecutar (subagent-driven-development o executing-plans) + verificación.
