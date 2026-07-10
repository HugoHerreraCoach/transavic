# 21 — Clientes Avícola (venta en campo del Gerente General)

> **Creado:** 2026-07-07 · **Estado:** BETA (chip índigo), desplegado junto con la expansión ERP
> **Requerimiento origen:** docx "Requerimiento de Implementación — Módulo Clientes Avícola" (Antonio/Nelita, 7 jul 2026)
> **Cuándo leer esto:** vas a tocar cualquier cosa bajo `src/app/dashboard/clientes-avicola/`, `src/app/api/avicola/` o `src/lib/avicola/`.

---

## 1. Qué es y qué NO es

**Es** el módulo de la operación de venta n.º 1 de Antonio: él mismo visita puestos de mercados y
avícolas, vende por peso (kg × precio/kg), **cobra deudas (abonos)** y manda una **guía interna por
WhatsApp** en el momento. Reemplaza el Excel de control de saldos. Optimizado para celular.

**NO es**:
- El flujo de las asesoras (operación 2: CRM leads → pedidos → despacho). Cero intersección.
- El POS de planta (operación 3).
- Nada SUNAT: la "guía de venta" es un documento INTERNO informal (correlativo propio
  `guia_avicola` en la tabla `correlativos`), no la GRE legal (`comprobantes_guias`) ni la orden
  de pedido (`orden_pedido`).

### Las 3 operaciones de venta (definidas por Antonio, 7 jul 2026)

| # | Operación | Módulo | Estado |
|---|---|---|---|
| 1 | Venta en campo (mercados/avícolas), con cobranza y guía inmediata | **Clientes Avícola** (este doc) | ✅ construido |
| 2 | Ejecutivas → negocios (restaurantes, chifas, dark kitchens) | CRM leads + pedidos + despacho | ✅ existente. ⚠️ "Cotizaciones" formales NO existen (solo etapa "Propuesta" del kanban) — pendiente confirmar con Antonio si las necesita |
| 3 | Venta rápida en planta | POS planta | ✅ existente + panel post-venta agregado (Imprimir orden / Emitir comprobante) el 7 jul 2026 |

---

## 2. Decisión de arquitectura: independencia TOTAL

Tablas propias, sin tocar `pedidos`/`clientes`/`facturas`. Razones:
1. El requerimiento lo pide textual ("completamente independiente del módulo de ventas de las ejecutivas").
2. Reutilizar `pedidos` con un `origen` nuevo **contaminaría las metas/ranking de asesoras**: los
   filtros son `COALESCE(origen,'asesor') <> 'pos_planta'` (en `ventas-metricas.ts`,
   `datos-ventas.ts`, `insights.ts`) y un origen nuevo caería del lado "asesor".
3. `pedidos` arrastra máquina de estados/despacho/riders que aquí no aplican; `facturas` no modela
   abonos parciales; `clientes` tiene scoping por asesora.

Consecuencia: **los reportes existentes (consolidado, rentabilidad, metas) NO incluyen estas
ventas.** Es deliberado. Si algún día se quiere consolidar, se agrega la fuente explícitamente.

---

## 3. Modelo de datos

Migración: `scripts/migrate-clientes-avicola-2026-07-07.sql` (idempotente, por psql — gotchas #13/#17).

```
clientes_avicola      nombre, mercado (texto libre), numero_puesto?, telefono?, direccion?,
                      observaciones?, empresa (Transavic|Avícola de Tony → logo de la guía),
                      saldo_anterior NUMERIC (deuda pre-sistema, editable, puede ser negativo),
                      activo BOOLEAN
ventas_avicola        id UUID SIN default (lo genera el CLIENTE → idempotencia), cliente_id,
                      numero_guia INT UNIQUE (correlativo "guia_avicola"), fecha DATE Lima,
                      total (calculado en SERVER), anulada + anulacion_motivo (CHECK), creado_por
venta_avicola_items   producto_id? (FK viva p/ reporte kg), producto_nombre (denormalizado),
                      peso_kg > 0, precio_kg >= 0, subtotal = round2(peso*precio) server-side
abonos_avicola        id UUID del cliente (idempotencia), cliente_id, fecha, monto > 0,
                      medio_pago (efectivo|transferencia|yape|plin|otro),
                      comprobante_data/mime (foto webp base64, single-photo),
                      anulado + anulacion_motivo, creado_por
```

### Reglas de oro
1. **El saldo NUNCA se persiste** — se calcula al vuelo:
   `saldo_actual = saldo_anterior + Σ ventas (NOT anulada) − Σ abonos (NOT anulado)`.
   Única fuente: **`src/lib/avicola/saldos.ts`** (`listaClientesConSaldo`, `estadoCuentaCliente`,
   `estadoCuentaParaGuia`). NO dupliques esos SUMs.
2. **Anulación soft, nunca DELETE** (motivo obligatorio ≥5 chars). Toda query filtra
   `NOT anulada/anulado` — misma disciplina que `facturas.estado='Anulada'` (gotcha #24).
   **Editar una venta ya enviada SÍ se puede** (desde 9 jul 2026, pedido de Antonio: en la tarde el GG
   ajusta el peso/precio reales al cobrar): PATCH `/api/avicola/ventas/[id]` cambia peso/precio/fecha/
   observaciones, **recalcula el total en server** (transacción atómica: `DELETE` items → re-`INSERT` →
   `UPDATE` cabecera), **audita** `modificada_por`/`modificada_at`, y se **bloquea si la venta está anulada**
   (409). El botón "Editar" de la ficha abre el MISMO form en modo `?edit=<uuid>` (`GET` del route devuelve
   los ítems crudos). La anulación soft se conserva para descartar una venta entera (no para corregir).
3. **La fecha de la venta es seleccionable** (alta y edición): **retroactiva permitida** (para cargar lo
   de un domingo/feriado o cuando la asistente no registró), **futura NO** (validado en server, zona Lima).
   Por defecto es hoy; en la UI es un chip compacto en el header ("Hoy", o ámbar con el día si es pasado).
4. **Idempotencia doble-tap**: la PK de venta/abono la genera el FRONTEND (`crypto.randomUUID()` al
   montar el form, reusada en reintentos). El POST pre-checkea por id y captura `23505` → responde
   200 con lo ya guardado (mismo número de guía). No quitar.
5. **La guía es reimprimible y estable**: su estado de cuenta va ANCLADO al `created_at` de la venta
   (`estadoCuentaParaGuia`): `saldo_previo` = movimientos anteriores; `abonos_del_dia` = abonos del
   mismo día posteriores a la venta (el corte por `created_at` evita doble conteo).
6. Sobrepago de abono = **409 blando** (`requiere_confirmacion`) + `permitir_sobrepago:true` →
   saldo negativo se muestra "a favor". La cartera usa `GREATEST(saldo, 0)`.
7. Cliente **inactivo**: ventas bloqueadas (409), abonos permitidos, deuda sigue en cartera/rankings.
8. **La grilla de productos se ordena sola** (9 jul 2026, pedido de Antonio): en la venta, el catálogo (~90
   ítems) se corta en secciones — **Fijados** (estrella manual, `localStorage` `transavic_avicola_favoritos`,
   por dispositivo) → **Lo de siempre** (lo que ESE cliente ya compró, ordenado por **frecuencia** y desempate
   por recencia) → **Más vendidos** (top global, solo si el cliente aún no compró nada) → **Todo el catálogo**.
   Cada producto aparece UNA vez. Además hay un botón **"Repetir última venta"** que siembra los productos de la
   última venta con su precio y los pesos vacíos, con el foco en el primer peso (solo con el carrito vacío, para
   no pisar nada). Ese botón **previsualiza** qué trae: 2ª línea con hasta 2 nombres **truncados** + una píldora
   con el **TOTAL** ("3 productos"). Se muestra el total —y no "+N restantes"— **a propósito**: como los nombres
   del catálogo son larguísimos y se recortan, un "+1 más" haría creer que son 2 cuando son 3. Las 3 consultas
   viven en `venta/page.tsx`.
9. **Buscador de productos** (9 jul 2026): fijo en el header (2ª fila, siempre visible al scrollear), filtra el
   catálogo en vivo **por nombre O categoría** (escribir "pollo" trae todo el pollo; "alas" trae solo Alas), con
   estado "no se encontró…" + botón para limpiar. Al buscar, **las secciones se aplanan** en una sola lista
   filtrada: el buscador manda y no hay que pensar en secciones.
10. **v1 NO toca inventario ni caja/cuentas** (decisión 7 jul 2026): no se sabe cómo se abastece el
   camión de Antonio (pendiente confirmar). Los kg por producto/día SÍ quedan registrados
   (`venta_avicola_items` + liquidación) → activar el descuento después es un cambio acotado.

---

## 4. Mapa de archivos

| Capa | Archivo | Qué hace |
|---|---|---|
| Lib | `src/lib/avicola/types.ts` | Tipos + `MEDIOS_PAGO_AVICOLA` + shapes de respuesta de TODAS las APIs |
| Lib | `src/lib/avicola/saldos.ts` | Aritmética del saldo (única fuente) |
| Lib | `src/lib/avicola/historial.ts` | Historial ventas+abonos intercalado (anulados marcados) |
| Lib | `src/lib/avicola/guia.ts` | `guiaDeVenta()` → `GuiaAvicolaData` completa para el ticket |
| Lib | `src/lib/reportes/pdf-estado-cuenta-avicola.ts` | PDF estado de cuenta (jsPDF, clon de pdf-ventas) |
| API | `src/app/api/avicola/clientes` (+`[id]`) | CRUD + ficha con historial |
| API | `src/app/api/avicola/ventas` (+`[id]`, `[id]/anular`) | POST idempotente (`sql.transaction` patrón POS), guía |
| API | `src/app/api/avicola/abonos` (+`[id]/anular`, `[id]/comprobante`) | Abonos + sobrepago + foto |
| API | `src/app/api/avicola/liquidacion` · `dashboard` | Reportes (shapes en types.ts) |
| UI | `clientes-avicola/page.tsx` + `lista-client.tsx` | Home: búsqueda client-side, chips mercado, Vender/Abonar |
| UI | `[id]/page.tsx` + `ficha-client.tsx` | Ficha 360: héroe 2×2, historial, reenviar guía, anular |
| UI | `[id]/venta/*` | Venta rápida y **edición** (`?edit=<uuid>`): buscador fijo en el header + chip de fecha compacto ("Hoy"/ámbar si es retroactiva); productos en secciones (Fijados ⭐ → Lo de siempre → Más vendidos → Todo el catálogo) con **último precio por cliente+producto**; botón "Repetir última venta"; footer sticky |
| UI | `ticket-guia-avicola.tsx` + `guia-avicola-modal.tsx` | Ticket 500px + toJpeg → `navigator.share` (clon ticket-share-modal); toggle precios en localStorage `transavic_avicola_opcion_guia` |
| UI | `abono-modal.tsx` · `cliente-avicola-form.tsx` · `estado-cuenta-modal.tsx` | Modales compartidos |
| UI | `liquidacion/*` · `panel/*` | Liquidación del día + panel gerencial |

Acceso: **solo `admin`** (guard en cada page + cada API). Sidebar: entrada Primary+Beta en
"Ventas & CRM" (`DashboardLayout.tsx`); guía de pasos clave `"clientes-avicola"` en `guias-modulos.ts`.

## 5. La guía de venta (req. §7-9 del docx)

- Correlativo propio: tipo `"guia_avicola"` en `src/lib/correlativos.ts` (UPSERT, arranca solo).
- Selector de 2 formatos (req. §8): "Con precio por kilo" / "Solo peso y total" — la Opción 2 oculta
  ÚNICAMENTE la columna precio/kg; el importe por producto y el total SIEMPRE se muestran.
- Bloque estado de cuenta (req. §9): Saldo anterior / Venta de hoy / Abonos de hoy (si >0) / SALDO ACTUAL.
- Envío: JPEG generado con `html-to-image` (pixelRatio 2.5) → `navigator.share({files})` → WhatsApp.
  Fallback: Descargar. El logo sale de `clientes_avicola.empresa`.
- ⚠️ **El logo del ticket** (ver **gotcha #43**): va como `data:` URL, así que **NUNCA** le pongas
  `crossOrigin` al `<img>` — en WebKit/iOS eso fuerza una petición CORS que falla y **la guía sale sin logo en
  iPhone** (en Chrome de escritorio sí se ve, por eso es fácil no cazarlo). Y antes de `toJpeg` hay que esperar
  `await img.decode()` de las imágenes del ticket: `html-to-image` en iOS omite las que no están decodificadas.

## 6. Pendientes de negocio (confirmar con Antonio)

1. ¿Cómo se abastece el camión? → decide si las ventas de campo descuentan inventario (hoy NO).
2. ¿Algún cliente de mercado compra bajo "Avícola de Tony"? (el campo ya existe, default Transavic).
3. ¿Necesita cotizaciones formales en el CRM (operación 2)? Hoy no existen como documento.
4. Migración a producción: aplicar el SQL por psql ANTES del deploy (gotcha #17).
